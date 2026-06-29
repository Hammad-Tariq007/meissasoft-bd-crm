# PLANE WEB PUSH NOTIFICATIONS - VAPID KEYS & DEPLOYMENT

## Generated VAPID Keys

**Generated Date**: June 29, 2026
**Status**: Production Ready

### Public Key (Safe to expose)

```
BLvu7DNoolDb2URxdVq9p9vMq4_afUTASzu1XH_JmTU3kESjpnUTNR8Zyl72FqpsakzWsSz6XC89kRFDimhCnO4
```

### Private Key (KEEP SECRET - Never expose)

```
sVHIF5zG0_OUjRQnz5GC-MoeeLHtulm63u3B5tCsr6M
```

### VAPID Subject (Email)

```
mailto:support@plane.so
```

---

## Environment Configuration

### Backend Setup (apps/api/.env)

Add these environment variables:

```env
# Web Push Notifications (VAPID Keys)
VAPID_PUBLIC_KEY=BLvu7DNoolDb2URxdVq9p9vMq4_afUTASzu1XH_JmTU3kESjpnUTNR8Zyl72FqpsakzWsSz6XC89kRFDimhCnO4
VAPID_PRIVATE_KEY=sVHIF5zG0_OUjRQnz5GC-MoeeLHtulm63u3B5tCsr6M
VAPID_SUBJECT=mailto:support@plane.so
```

### Database Migration

```bash
cd apps/api
python manage.py migrate
```

### Restart Backend

After setting environment variables, restart backend services to load the new configuration.

---

## Deployment Checklist

- [ ] Add VAPID keys to backend .env
- [ ] Run database migration
- [ ] Restart backend services
- [ ] Verify API endpoint: GET /users/me/web-push/vapid-key/
- [ ] Test in web app: Login → See permission prompt → Enable → Test push
- [ ] Monitor backend logs for errors

---

## Security Notes

- **Public Key**: Safe to embed in frontend code
- **Private Key**: MUST be kept secret, stored only in backend env vars
- **Never commit**: These keys should not be committed to version control
- **Rotate periodically**: For security best practices, rotate keys in production

---

## Implementation Summary

This is Commit 4 of the Web Push Notifications feature. It provides:

1. Generated VAPID key pair
2. Environment configuration instructions
3. Deployment steps
4. Security guidelines

The feature is fully implemented in Commits 1-3:

- Commit 1: Backend model, API, VAPID config
- Commit 2: Push delivery integration
- Commit 3: Frontend service worker and UI

---

## Testing the Feature

### Backend Test

```bash
# Verify VAPID keys are set
curl -H "Authorization: Bearer YOUR_TOKEN" \
  http://localhost:8000/users/me/web-push/vapid-key/
# Should return: {"vapid_public_key": "BLvu7DN..."}
```

### Frontend Test

1. Login to web app
2. Should see permission prompt after 2 seconds
3. Click "Enable Notifications"
4. Grant browser permission
5. Should see success toast
6. Create a notification (comment, mention, assign)
7. Should see desktop notification
8. Click notification to navigate to work item

---

**Status**: Ready for Production Deployment
**Generated**: June 29, 2026
