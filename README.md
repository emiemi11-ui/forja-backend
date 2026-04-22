# FORJA Backend

Express · Prisma · PostgreSQL · Socket.IO · JWT.
Backend complet pentru aplicația FORJA (fitness SaaS): autentificare cu roluri
(USER / COACH / NUTRITIONIST / ADMIN), dashboard personal, echipe, feed,
workout sessions, chat în timp real, mesagerie privată și panou admin.

---

## Ce face

- **~30 endpoint-uri REST** sub `/api/*` cu shape-uri identice cu ce cere frontend-ul
- **Socket.IO realtime**: `dm:new`, `chat:new`, `feed:new` / `feed:like` / `feed:comment`, `team:updated`
- **Prisma ORM** cu migrări versionate + seed reproductibil
- **JWT Bearer** + middleware cu roluri
- **SSL auto** pentru baze cloud (Neon, Supabase, Railway, Render)
- **Upload avatare** (multer, data URLs — merge fără storage extern)
- **Audit log** complet pentru acțiuni admin
- **Compatibil out-of-the-box** cu Neon, Railway și Vercel

---

## Cerințe

- **Node.js** 20+ (ESM, fetch nativ)
- **PostgreSQL** 14+
- Contul Neon e gratuit și nu cere card.

---

## Deploy online: Neon + Railway + Vercel (~10 minute)

### A. Bază de date pe **Neon**

1. https://neon.tech → Sign up cu GitHub
2. **Create Project** → nume `forja`, regiune `Europe (Frankfurt)` sau `EU West`
3. Copiază **Connection string** din dashboard:
   ```
   postgres://neondb_owner:xxxx@ep-xxx.eu-central-1.aws.neon.tech/neondb?sslmode=require
   ```
   (Backend-ul adaugă `sslmode=require` automat dacă lipsește.)

### B. Backend pe **Railway**

1. Pune codul pe GitHub într-un repo nou (`forja-backend`)
2. https://railway.app → Login cu GitHub → **New Project** → **Deploy from GitHub repo**
3. Railway detectează automat că e Node.js
4. **Variables** → adaugă:
   ```
   DATABASE_URL       = [string-ul copiat de la Neon]
   JWT_SECRET         = [un string lung, random]
   JWT_EXPIRES_IN     = 7d
   ADMIN_EMAIL        = admin@forja.ro
   ADMIN_PASSWORD     = [parolă nouă pentru admin-ul real]
   ADMIN_NAME         = FORJA Admin
   NODE_ENV           = production
   FRONTEND_URL       = [temporar gol, completezi după Vercel]
   ```
5. **Settings** → **Networking** → **Generate Domain**:
   ```
   https://forja-backend-production.up.railway.app
   ```
6. Deploy-ul rulează automat `npm run setup:prod && npm start`:
   - `prisma generate` + `prisma db push` (aplică schema pe Neon)
   - `node prisma/seed.js` (conturile demo + date de test)
   - pornește serverul

### C. Frontend pe **Vercel**

1. Pune frontend-ul pe GitHub (`forja-frontend`)
2. https://vercel.com → **Add New → Project** → Import
3. Framework: **Vite** (auto-detectat)
4. **Environment Variables**:
   ```
   VITE_API_URL = https://forja-backend-production.up.railway.app
   ```
   (fără `/api` la final)
5. **Deploy** → primești `https://forja.vercel.app`

### D. Conectare finală

1. Înapoi la Railway → Variables → updatează:
   ```
   FRONTEND_URL = https://forja.vercel.app
   ```
2. Railway redeployza automat.
3. `https://forja.vercel.app` → loghează-te cu `user@forja.ro` / `demo1234`. 🎉

---

## Rulare locală (dev)

```bash
npm install

cp .env.example .env
# editează DATABASE_URL în .env

createdb forja
npm run db:push
npm run db:seed

npm run dev       # auto-reload
```

Serverul pe `http://localhost:3001`. În frontend `.env`:
```ini
VITE_API_URL=http://localhost:3001
```

---

## Conturi demo

Toate parolele: **`demo1234`**

| Email                    | Rol           | Redirect         |
| ------------------------ | ------------- | ---------------- |
| `user@forja.ro`          | USER          | `/app`           |
| `coach@forja.ro`         | COACH         | `/coach`         |
| `nutritionist@forja.ro`  | NUTRITIONIST  | `/nutritionist`  |
| `admin@forja.ro`         | ADMIN         | `/admin`         |

Plus `maria.s@forja.ro`, `andrei.m@forja.ro`, `dan.g@forja.ro`, `ioana.p@forja.ro`,
`radu.p@forja.ro`, `ana.v@forja.ro`, `ana.mo@forja.ro` (parolă identică).

---

## Variabile de mediu

| Nume                 | Rol                                                              |
| -------------------- | ---------------------------------------------------------------- |
| `DATABASE_URL`       | Connection string PostgreSQL                                     |
| `DIRECT_URL`         | (Prisma) același ca `DATABASE_URL` dacă nu folosești pooling     |
| `JWT_SECRET`         | String lung random — **schimbă în producție!**                   |
| `JWT_EXPIRES_IN`     | Ex: `7d`                                                         |
| `PORT`               | Default `3001`. Railway îl setează automat                       |
| `NODE_ENV`           | `development` / `production`                                     |
| `FRONTEND_URL`       | URL-ul Vercel — folosit pentru CORS                              |
| `FRONTEND_URL_EXTRA` | Origini CORS suplimentare (comma-separated, suportă wildcards)   |
| `ADMIN_EMAIL`        | Emailul admin-ului real creat la boot                            |
| `ADMIN_PASSWORD`     | Parola admin-ului real                                           |
| `ADMIN_NAME`         | Numele afișat                                                    |
| `ADMIN_BOOTSTRAP_KEY`| Permite creare admin via `POST /auth/register`                    |
| `PGSSL`              | `true` pentru a forța SSL                                         |

---

## Testare

```bash
npm run test:smoke      # ~35 de verificări, tot API-ul
npm run test:realtime   # verifică dm:new end-to-end
```

Cu target custom:
```bash
API_URL=https://forja-backend.up.railway.app npm run test:smoke
```

---

## Evenimente Socket.IO

**Conectare** (clientul trimite JWT):
```js
import { io } from 'socket.io-client';
const socket = io(API_URL, { auth: { token } });
```

La conectare, server-ul pune automat socket-ul în camere:
- `user:<id>` — canal privat (DM-uri)
- `team:<teamId>` — pentru fiecare echipă din care face parte

**Evenimente emise:**

| Eveniment        | Payload                                                               |
| ---------------- | --------------------------------------------------------------------- |
| `dm:new`         | `{ conversationId, message: { id, message, isMe, time, senderId } }` |
| `chat:new`       | `{ id, teamId, msg, from, sender, time, isMe, senderId, avatar }`    |
| `feed:new`       | `{ post }` sau `{ teamId, post }`                                    |
| `feed:like`      | `{ postId, likes, liked }`                                            |
| `feed:comment`   | `{ postId, comment }`                                                 |
| `team:updated`   | `{ teamId }`                                                          |
| `team:joined`    | `{ teamId }`                                                          |

---

## Structura codului

```
forja-backend/
├── package.json
├── railway.json
├── Procfile
├── .env.example
├── prisma/
│   ├── schema.prisma
│   ├── seed.js
│   ├── ensure-launch-admin.js
│   ├── claim-first-admin.js
│   └── migrations/
├── src/
│   ├── server.js              # Express + Socket.IO + CORS
│   ├── lib/prisma.js          # Prisma client cu SSL auto
│   ├── middleware/auth.js
│   ├── utils/
│   └── routes/
│       ├── auth.js
│       ├── user.js            # /user + /goals + /dashboard
│       ├── athlete.js         # sleep / meals / exercises / workout / discover
│       ├── posts.js           # /feed
│       ├── teams.js
│       ├── messages.js        # DMs
│       ├── chat.js            # team chat
│       ├── coach.js
│       ├── nutritionist.js
│       ├── admin.js
│       ├── challenges.js
│       ├── search.js
│       ├── achievements.js
│       └── public.js
└── tests/
    ├── smoke.js
    └── realtime.js
```

---

## Troubleshooting

**`P1001: Can't reach database` la boot pe Railway.**
Verifică `DATABASE_URL` — copiat exact de la Neon.

**CORS error din frontend.**
Setează `FRONTEND_URL` pe Railway la URL-ul Vercel exact (fără slash la final).

**WebSocket „Unauthorized".**
Token-ul JWT lipsește din `auth.token`. Verifică `localStorage.getItem('token')`.

**Setup-ul blochează primul deploy.**
Railway → Shell → rulează manual:
```bash
npx prisma generate
npx prisma db push --accept-data-loss
node prisma/seed.js
```

**Reset bază demo în producție** (șterge TOT):
```bash
npx prisma migrate reset --force
```

---

## Note

- **bcrypt** 12 salt rounds pentru parole
- **JWT** în `Authorization: Bearer <token>` (nu cookies → fără CSRF standard)
- **Socket.IO** validează la handshake
- **Prisma** generează tipuri TypeScript dacă migrezi în viitor
- Connection pooling: disponibil din Neon sau via Prisma Accelerate
