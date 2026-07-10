# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""
Ephemeral live-presence state, backed entirely by Redis (no Postgres writes on the
heartbeat/read hot path). The status shown to others is derived per user from:

    - their durable manual override (User.presence_manual_status, re-asserted every beat)
    - whether any live tab is currently active vs idle

Manual override precedence:
    - OFFLINE : the user chose "appear offline" -> omitted from the map entirely
    - DND     : sticky, mutes notifications
    - AWAY    : sticky manual away
    - ONLINE  : default "auto" mode -> active tab => online, all tabs idle => away

A user with no live session key (heartbeat lapsed / disconnected) is always OFFLINE,
regardless of their manual override.

Key schema (all TTL-bound so state self-cleans on disconnect):
    presence:sessions:{user_id}      HASH   field=session_id -> "active|idle:{epoch}"   EXPIRE PRESENCE_TTL
    presence:online:{workspace_id}   ZSET   member=user_id, score=last-heartbeat epoch
    presence:manual:{user_id}        STRING the manual override (omitted when "online")  EX PRESENCE_TTL
"""

import time

from plane.settings.redis import redis_instance

# Cadences / lifetimes (seconds). PRESENCE_TTL is kept well above the heartbeat (>=2x) so
# a backgrounded tab (whose timers the browser throttles) is tolerated before its session
# is considered gone. POLL gates how fast other clients observe a change; 10s is
# imperceptible for "who's around" and far lighter on shared infra than a sub-second loop.
HEARTBEAT_INTERVAL = 45
POLL_INTERVAL = 10
PRESENCE_TTL = 120

# Durable "last seen"/"last active" survive the ephemeral session/online keys so we can
# show a timestamp for OFFLINE users too. Kept in a per-workspace hash (one field per
# member) rather than the DB: no migration, no Postgres write on the 45s hot path, and
# growth is bounded by the member count. A generous TTL, refreshed on every beat, lets a
# fully-dormant workspace self-clean without ever expiring an active one.
LASTSEEN_TTL = 30 * 24 * 60 * 60  # 30 days

# Statuses returned to clients. OFFLINE is represented by absence from the map.
STATUS_ONLINE = "online"
STATUS_AWAY = "away"
STATUS_DND = "dnd"
STATUS_OFFLINE = "offline"

# Manual override values (mirror of User.PresenceManualStatus). "online" is the
# implicit default and is stored as absence of the key to keep writes minimal.
DEFAULT_MANUAL_STATUS = STATUS_ONLINE
MANUAL_STATUSES = {STATUS_ONLINE, STATUS_AWAY, STATUS_DND, STATUS_OFFLINE}


def _sessions_key(user_id):
    return f"presence:sessions:{user_id}"


def _online_key(workspace_id):
    return f"presence:online:{workspace_id}"


def _manual_key(user_id):
    return f"presence:manual:{user_id}"


def _lastseen_key(workspace_id):
    return f"presence:lastseen:{workspace_id}"


def _lastactive_key(workspace_id):
    return f"presence:lastactive:{workspace_id}"


def _now():
    return int(time.time())


def _decode(value):
    return value.decode() if isinstance(value, (bytes, bytearray)) else value


def _normalize_manual(manual_status):
    return manual_status if manual_status in MANUAL_STATUSES else DEFAULT_MANUAL_STATUS


def record_heartbeat(*, workspace_id, user_id, session_id, idle, manual_status):
    """Record a single tab's heartbeat. Refreshes all TTLs for this user."""
    ri = redis_instance()
    now = _now()
    state = "idle" if idle else "active"
    user_id = str(user_id)
    manual_status = _normalize_manual(manual_status)

    pipe = ri.pipeline()
    pipe.hset(_sessions_key(user_id), session_id, f"{state}:{now}")
    pipe.expire(_sessions_key(user_id), PRESENCE_TTL)
    pipe.zadd(_online_key(workspace_id), {user_id: now})
    # Durable trail (survives the TTL keys): last_seen every beat, last_active only when
    # the tab is genuinely active — so Away/DND can show "since last real interaction"
    # rather than "since last heartbeat".
    pipe.hset(_lastseen_key(workspace_id), user_id, now)
    pipe.expire(_lastseen_key(workspace_id), LASTSEEN_TTL)
    if state == "active":
        pipe.hset(_lastactive_key(workspace_id), user_id, now)
        pipe.expire(_lastactive_key(workspace_id), LASTSEEN_TTL)
    # client re-asserts its durable override each beat, so the mirror stays fresh even
    # across a Redis flush and self-expires once the user disconnects. "online" is the
    # default, stored as absence of the key.
    if manual_status == DEFAULT_MANUAL_STATUS:
        pipe.delete(_manual_key(user_id))
    else:
        pipe.set(_manual_key(user_id), manual_status, ex=PRESENCE_TTL)
    pipe.execute()


def remove_session(*, workspace_id, user_id, session_id):
    """Best-effort immediate offline for one tab (e.g. sendBeacon on unload)."""
    ri = redis_instance()
    user_id = str(user_id)
    ri.hdel(_sessions_key(user_id), session_id)
    if not ri.hlen(_sessions_key(user_id)):
        ri.zrem(_online_key(workspace_id), user_id)


def set_manual_status(*, user_id, manual_status):
    """Mirror the durable Postgres manual override into Redis for the hot read path."""
    ri = redis_instance()
    user_id = str(user_id)
    manual_status = _normalize_manual(manual_status)
    if manual_status == DEFAULT_MANUAL_STATUS:
        ri.delete(_manual_key(user_id))
    else:
        ri.set(_manual_key(user_id), manual_status, ex=PRESENCE_TTL)


def _to_epoch(value):
    value = _decode(value)
    return int(value) if value and str(value).isdigit() else None


def get_workspace_presence(workspace_id):
    """
    Return {user_id: {status, last_seen, last_active}} for every user with a durable
    trail in the workspace — INCLUDING offline ones (so the sidebar can keep them). A
    live user who manually "appears offline" is omitted entirely (privacy: hidden while
    online); once they actually disconnect they fall through to a normal OFFLINE row.

    status is derived by unioning each user's live tabs against their manual override;
    a user with no live/fresh session is OFFLINE regardless of override.
    """
    ri = redis_instance()
    now = _now()
    cutoff = now - PRESENCE_TTL
    online_key = _online_key(workspace_id)

    # prune expired members from the ZSET, then read who is still live
    ri.zremrangebyscore(online_key, 0, cutoff)
    live_ids = {_decode(uid) for uid in ri.zrangebyscore(online_key, cutoff, "+inf")}

    last_seen = {_decode(k): _to_epoch(v) for k, v in ri.hgetall(_lastseen_key(workspace_id)).items()}
    last_active = {_decode(k): _to_epoch(v) for k, v in ri.hgetall(_lastactive_key(workspace_id)).items()}
    if not last_seen:
        return {}

    # For the live users, pull sessions + manual override to derive their live status.
    live_list = [uid for uid in last_seen if uid in live_ids]
    live_status = {}
    if live_list:
        pipe = ri.pipeline()
        for uid in live_list:
            pipe.hgetall(_sessions_key(uid))
        for uid in live_list:
            pipe.get(_manual_key(uid))
        results = pipe.execute()
        session_maps = results[: len(live_list)]
        manual_flags = results[len(live_list) :]
        for index, uid in enumerate(live_list):
            any_live = False
            any_active = False
            for raw_state in (session_maps[index] or {}).values():
                state, _, ts = _decode(raw_state).rpartition(":")
                if not ts.isdigit() or int(ts) < cutoff:
                    continue
                any_live = True
                if state == "active":
                    any_active = True
            if not any_live:
                continue  # ZSET stale; treat as offline below
            manual = _decode(manual_flags[index]) or DEFAULT_MANUAL_STATUS
            if manual == STATUS_OFFLINE:
                live_status[uid] = None  # appear-offline while live -> omit
            elif manual == STATUS_DND:
                live_status[uid] = STATUS_DND
            elif manual == STATUS_AWAY:
                live_status[uid] = STATUS_AWAY
            else:  # auto mode: activity decides
                live_status[uid] = STATUS_ONLINE if any_active else STATUS_AWAY

    result = {}
    for uid, seen in last_seen.items():
        status = live_status.get(uid, STATUS_OFFLINE)
        if status is None:
            continue  # hidden: live + appear-offline
        result[uid] = {
            "status": status,
            "last_seen": seen,
            "last_active": last_active.get(uid),
        }
    return result
