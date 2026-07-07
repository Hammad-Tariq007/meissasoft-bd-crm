# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""
Ephemeral live-presence state, backed entirely by Redis (no Postgres writes on the
heartbeat/read hot path). Volatile states are derived, never stored:

    - OFFLINE : the user has no live session key (heartbeat lapsed / disconnected)
    - DND     : manual sticky override, asserted by the client on every heartbeat
                (durable source of truth is User.presence_manual_status)
    - ONLINE  : at least one live tab is active (union across the user's tabs)
    - AWAY    : the user is present but every live tab is idle

Key schema (all TTL-bound so state self-cleans on disconnect):
    presence:sessions:{user_id}      HASH   field=session_id -> "active|idle:{epoch}"   EXPIRE PRESENCE_TTL
    presence:online:{workspace_id}   ZSET   member=user_id, score=last-heartbeat epoch
    presence:dnd:{user_id}           STRING "1" while DND is on                          EX PRESENCE_TTL
"""

import time

from plane.settings.redis import redis_instance

# Cadences / lifetimes (seconds). PRESENCE_TTL is ~2.7x the heartbeat so one missed
# beat is tolerated before a session is considered gone.
HEARTBEAT_INTERVAL = 45
POLL_INTERVAL = 45
PRESENCE_TTL = 120

# Derived statuses returned to clients. OFFLINE is represented by absence from the map.
STATUS_ONLINE = "online"
STATUS_AWAY = "away"
STATUS_DND = "dnd"


def _sessions_key(user_id):
    return f"presence:sessions:{user_id}"


def _online_key(workspace_id):
    return f"presence:online:{workspace_id}"


def _dnd_key(user_id):
    return f"presence:dnd:{user_id}"


def _now():
    return int(time.time())


def _decode(value):
    return value.decode() if isinstance(value, (bytes, bytearray)) else value


def record_heartbeat(*, workspace_id, user_id, session_id, idle, dnd):
    """Record a single tab's heartbeat. Refreshes all TTLs for this user."""
    ri = redis_instance()
    now = _now()
    state = "idle" if idle else "active"
    user_id = str(user_id)

    pipe = ri.pipeline()
    pipe.hset(_sessions_key(user_id), session_id, f"{state}:{now}")
    pipe.expire(_sessions_key(user_id), PRESENCE_TTL)
    pipe.zadd(_online_key(workspace_id), {user_id: now})
    # client re-asserts its durable DND each beat, so the mirror stays fresh even
    # across a Redis flush and self-expires once the user disconnects.
    if dnd:
        pipe.set(_dnd_key(user_id), "1", ex=PRESENCE_TTL)
    else:
        pipe.delete(_dnd_key(user_id))
    pipe.execute()


def remove_session(*, workspace_id, user_id, session_id):
    """Best-effort immediate offline for one tab (e.g. sendBeacon on unload)."""
    ri = redis_instance()
    user_id = str(user_id)
    ri.hdel(_sessions_key(user_id), session_id)
    if not ri.hlen(_sessions_key(user_id)):
        ri.zrem(_online_key(workspace_id), user_id)


def set_manual_dnd(*, user_id, dnd):
    """Mirror the durable Postgres DND flag into Redis for the hot read path."""
    ri = redis_instance()
    user_id = str(user_id)
    if dnd:
        ri.set(_dnd_key(user_id), "1", ex=PRESENCE_TTL)
    else:
        ri.delete(_dnd_key(user_id))


def get_workspace_presence(workspace_id):
    """
    Return {user_id: status} for every present user in the workspace. Offline users
    are omitted (absence == offline). Status is derived by unioning each user's tabs.
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
        pipe.get(_dnd_key(uid))
    results = pipe.execute()
    session_maps = results[: len(present_ids)]
    dnd_flags = results[len(present_ids) :]

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
        if dnd_flags[index]:
            statuses[uid] = STATUS_DND
        elif any_active:
            statuses[uid] = STATUS_ONLINE
        else:
            statuses[uid] = STATUS_AWAY
    return statuses
