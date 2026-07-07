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

# Cadences / lifetimes (seconds). PRESENCE_TTL is kept well above the heartbeat so a
# backgrounded tab (whose timers the browser throttles) is tolerated before its session
# is considered gone. POLL is low because it gates how fast other clients observe a
# change; the read is a pure-Redis lookup so a short interval is cheap.
HEARTBEAT_INTERVAL = 45
POLL_INTERVAL = 1
PRESENCE_TTL = 120

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


def get_workspace_presence(workspace_id):
    """
    Return {user_id: status} for every present user in the workspace. Offline users
    (no live session, or manual "offline") are omitted. Status is derived by unioning
    each user's tabs against their manual override.
    """
    ri = redis_instance()
    now = _now()
    cutoff = now - PRESENCE_TTL
    online_key = _online_key(workspace_id)

    # prune expired members, then read who is still present
    ri.zremrangebyscore(online_key, 0, cutoff)
    present_ids = [_decode(uid) for uid in ri.zrangebyscore(online_key, cutoff, "+inf")]
    if not present_ids:
        return {}

    pipe = ri.pipeline()
    for uid in present_ids:
        pipe.hgetall(_sessions_key(uid))
    for uid in present_ids:
        pipe.get(_manual_key(uid))
    results = pipe.execute()
    session_maps = results[: len(present_ids)]
    manual_flags = results[len(present_ids) :]

    statuses = {}
    for index, uid in enumerate(present_ids):
        sessions = session_maps[index] or {}
        any_live = False
        any_active = False
        for raw_state in sessions.values():
            value = _decode(raw_state)
            state, _, ts = value.rpartition(":")
            if not ts.isdigit() or int(ts) < cutoff:
                continue
            any_live = True
            if state == "active":
                any_active = True
        if not any_live:
            # ZSET not yet pruned but every session hash field is stale -> offline
            continue
        manual = _decode(manual_flags[index]) or DEFAULT_MANUAL_STATUS
        if manual == STATUS_OFFLINE:
            continue  # user chose to appear offline
        if manual == STATUS_DND:
            statuses[uid] = STATUS_DND
        elif manual == STATUS_AWAY:
            statuses[uid] = STATUS_AWAY
        else:  # "online" auto mode: activity decides
            statuses[uid] = STATUS_ONLINE if any_active else STATUS_AWAY
    return statuses
