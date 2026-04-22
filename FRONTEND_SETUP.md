# Frontend setup — FORJA

Acest fișier e un shortcut pentru cum conectezi frontend-ul Vite la backend-ul ăsta.

## Local (dev)

În folder-ul frontend-ului, creează `.env`:

```ini
VITE_API_URL=http://localhost:3001
```

Apoi:
```bash
npm install
npm run dev
```

Deschide `http://localhost:5173` și loghează-te cu `user@forja.ro` / `demo1234`.

## Producție (Vercel)

1. Push cod pe GitHub
2. Vercel → Import → Framework: `Vite`
3. Environment Variables:
   ```
   VITE_API_URL = https://forja-backend-production.up.railway.app
   ```
   (URL-ul backend-ului de pe Railway, **fără `/api` la final**)
4. Deploy

După deploy, întoarce-te în Railway și setează `FRONTEND_URL` la URL-ul Vercel.
Asta completează CORS și totul va funcționa.

## Cum știi că merge

- Login cu `user@forja.ro` / `demo1234` → redirect la `/app`
- Dashboard-ul arată date reale (nu mock) — vezi numele real din Neon DB
- Deschide 2 tab-uri (unul `user@forja.ro`, altul `coach@forja.ro`), trimite DM
  — mesajul ajunge în celălalt tab în < 100 ms

## Verificare rapidă

Testează direct backend-ul:
```bash
curl https://forja-backend-production.up.railway.app/health
# → {"status":"ok","time":"..."}
```

Login curl:
```bash
curl -X POST https://forja-backend-production.up.railway.app/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"user@forja.ro","password":"demo1234"}'
```
