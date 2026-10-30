# Deploy the GameZone app (or your own MERN app)

The infrastructure doesn't depend on the app's business logic. The repository's `app/` contains the GameZone frontend and backend, configured for this deployment. Other MERN apps can be deployed by **pointing the tfvars file at them**, provided they follow a few conventions. This page has the checklist, the steps, and recipes for common app layouts.

---

## 1. Contract between your app and the platform

| The platform... | ...so your app must |
|---|---|
| Starts your backend container with `PORT=<app_port>` and `NODE_ENV=production` | Listen on `process.env.PORT` on all interfaces (`app.listen(port)`, not `app.listen(port, '127.0.0.1')`), or set `app_port` to the port it hard-codes |
| Routes only `api_path_patterns` (default `/api/*`) to the backend | Serve its API under `/api` (or list its prefixes: `["/api/*", "/auth/*", "/uploads/*"]`) |
| Health-checks `health_check_path` during deploys and every minute | Return HTTP 2xx there when healthy (ideally 503 when the DB is down) |
| Injects the MongoDB connection string as `mongodb_uri_env_name` | Read it from that env var (`MONGODB_URI`, `MONGO_URI`, `DATABASE_URL`...) |
| Injects every `app_environment` / `app_secrets` entry as env vars | Read its config from env vars (not from a committed `.env`) |
| Builds the backend with your `Dockerfile`, or `templates/Dockerfile.node` if there is none | Have a `start` script in `package.json` (and optionally `build`) when relying on the generic Dockerfile |
| Runs the container health check with `node -e "..."` | Use an image that has `node` on the PATH (any official `node:*` image) |
| Builds the frontend with `frontend_build_command` in `frontend_path` | Produce `<frontend_build_dir>/index.html` (+ assets) |
| Serves the frontend and API from **one domain** | Call the API with relative URLs (`/api/...`) or a base URL set to `/api` at build time |

### Minimal health endpoint

```js
// Express
import mongoose from 'mongoose';

app.get('/api/health', (req, res) => {
  const dbUp = mongoose.connection.readyState === 1;
  res.status(dbUp ? 200 : 503).json({ status: dbUp ? 'ok' : 'degraded' });
});
```

### Recommended Express settings behind CloudFront + nginx

```js
app.set('trust proxy', 2); // CloudFront + nginx -> correct req.ip, req.secure, secure cookies
```

---

## 2. Step by step

1. **Choose where the app lives.**
   - *Use GameZone*: `app/backend` and `app/frontend` are already configured; the defaults in `infra/environments/prod.tfvars` point to them.
   - *Replace GameZone*: replace `app/backend` and `app/frontend` with your folders and adjust the backend/frontend settings in tfvars.
   - *Keep your app where it is*: use relative (`../shop/server`) or absolute (`C:/projects/shop/server`) paths in tfvars. Forward slashes work on Windows too.
   - *Copy the toolkit into your repo*: see [section 4](#4-copy-this-toolkit-into-an-existing-repository).
2. **Create the environment file** `infra/environments/prod.tfvars` (copy the existing one) and adjust the backend, frontend and database settings.
3. **Secrets** go in `infra/environments/prod.secrets.tfvars` (copy `example.secrets.tfvars`):
   ```hcl
   app_secrets = {
     JWT_SECRET          = "generate-a-long-random-value"
     RAZORPAY_KEY_ID     = "your-key-id"
     RAZORPAY_KEY_SECRET = "your-key-secret"
     SMTP_HOST           = "smtp.example.com"
     SMTP_USER           = "your-email@example.com"
     SMTP_PASS           = "your-email-password"
   }
   ```
   GameZone reads `MONGO_URI` (configured by `mongodb_uri_env_name`), `JWT_SECRET`, Razorpay credentials, and SMTP settings from the environment. The frontend calls the same site's `/api` path; the Vite build setting is already configured for that.
4. **Lock files**: GameZone's lockfiles are included. For another app, or whenever dependencies change, run `npm install` in the frontend (and backend, if applicable) and commit the updated `package-lock.json`; the frontend deployment uses `npm ci`.
5. **Deploy**: `npm run deploy`. If the backend fails its health check, the deploy stops and shows the last 100 log lines.

Find the env var names your backend expects:

```bash
# list everything your server code reads from process.env
git grep -ho "process\.env\.[A-Z_0-9]*" -- server/ | sort -u
```

Every name except `PORT` and `NODE_ENV` should go in `app_environment` (non-secret), `app_secrets` (secret) or `mongodb_uri_env_name`.

---

## 3. Recipes

### Create React App frontend

```hcl
frontend_path          = "client"
frontend_build_command = "npm ci && npm run build"
frontend_build_dir     = "build"
frontend_build_env     = { REACT_APP_API_URL = "/api" }
```

CRA treats warnings as errors when `CI=true`. The deploy script doesn't set it, but GitHub Actions does. If the CI build fails on lint warnings, use `frontend_build_command = "npm ci && CI=false npm run build"`. This form works in CI (Linux shell); on Windows `cmd`, use `set CI=false&& npm run build`.

### Vite frontend with an API base URL

```hcl
frontend_build_env = { VITE_API_URL = "/api" }
```

```js
const API = import.meta.env.VITE_API_URL ?? '/api';
fetch(`${API}/products`);
```

> If your code uses an absolute URL like `http://localhost:5000/api` in production, change it to a relative one. The browser must call the same domain it loaded the page from.

### Backend on port 5000 reading `MONGO_URI`

```hcl
app_port             = 5000
mongodb_uri_env_name = "MONGO_URI"
```

### TypeScript backend

With the generic Dockerfile, have `"build": "tsc"` and `"start": "node dist/index.js"`. The build runs inside the image, then dev dependencies are pruned. Or write your own Dockerfile:

```dockerfile
FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/package.json ./
USER node
CMD ["node", "dist/index.js"]
```

### Monorepo (`server/` and `client/` in one repo)

```hcl
backend_path  = "../my-monorepo/server"
frontend_path = "../my-monorepo/client"
```

If the backend imports shared code from outside its folder (e.g. `../shared`), the Docker build context must include it. Write a Dockerfile at the monorepo root and set:

```hcl
backend_path       = "../my-monorepo"              # build context = repo root
backend_dockerfile = "../my-monorepo/server/Dockerfile"
```

`backend_path` must contain a `package.json` (checked by the script) and is used as the build context.

### npm workspaces / Yarn / pnpm

The generic Dockerfile supports npm. For Yarn or pnpm, write your own Dockerfile (`corepack enable` then `yarn install --immutable` / `pnpm install --frozen-lockfile`) and change `frontend_build_command`, e.g. `"corepack enable && pnpm install --frozen-lockfile && pnpm build"`.

### Backend that also serves the React build (`express.static`)

Some MERN apps serve `client/build` from Express in production. You can keep doing that by routing everything to the backend, but you lose the CDN benefits. Instead, deploy the frontend separately (as above) and remove or ignore the `express.static` part. Nothing breaks if it stays, because CloudFront only sends `/api/*` to the server.

### MongoDB Atlas (free M0 or paid)

```hcl
# prod.tfvars
database_mode        = "external"
mongodb_uri_env_name = "MONGO_URI"
```
```hcl
# prod.secrets.tfvars
mongodb_uri = "mongodb+srv://appuser:pass@cluster0.abcde.mongodb.net/shop?retryWrites=true&w=majority"
```

After the first deploy, add the server's Elastic IP (`terraform -chdir=infra output elastic_ip`) to Atlas *Network Access*. With a paid account, use **VPC peering / PrivateLink** instead of a public IP allow-list.

### Amazon DocumentDB (paid)

DocumentDB is MongoDB-compatible but requires TLS with the Amazon CA bundle, and doesn't support every MongoDB feature (check your queries). Use `database_mode = "external"` with a URI like:

```text
mongodb://user:pass@my-docdb.cluster-xxxx.us-east-1.docdb.amazonaws.com:27017/app?tls=true&tlsCAFile=/app/global-bundle.pem&replicaSet=rs0&readPreference=secondaryPreferred&retryWrites=false
```

Download `global-bundle.pem` into your image (`ADD https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem /app/`). The cluster goes in the **private subnets** (Terraform output `private_subnet_ids`), with a security group allowing port 27017 from the app server's security group (output `app_security_group_id`). The Terraform for this is sketched in [COSTS_AND_UPGRADES.md](COSTS_AND_UPGRADES.md#4-managed-database).

### WebSockets / socket.io

```hcl
api_path_patterns = ["/api/*", "/socket.io/*"]
```

CloudFront and nginx both pass WebSocket upgrades. The client must connect to the same origin: `io()` with no URL, or `io('/', { path: '/socket.io' })`. One server means no sticky-session concerns.

### File uploads

```hcl
client_max_body_size = "25m"
```

Files written to the container's filesystem disappear on redeploy. Store uploads in **S3** (or Cloudinary etc.). For S3, give the server role write access to a bucket (add a statement in `app-server/iam.tf`). The AWS SDK in your container picks up the instance role automatically, because IMDS hop limit 2 is already set.

### Background jobs / cron

Run them inside the backend process (e.g. `node-cron`) since there's one instance. Or add a second service to `files/docker-compose.yml` using the same image with a different command.

### CORS-strict backends

If your backend only accepts a configured origin (`cors({ origin: process.env.CLIENT_URL })`), set `CLIENT_URL` to the app URL printed after the first deploy, then deploy again. Same-origin requests normally don't trigger CORS at all, so you can also allow the app's own origin.

### Several apps in one AWS account

Give each app its own `project_name` (e.g. `shop`, `blog`). Each gets a separate VPC, server, buckets, state and URL, and `npm run destroy` removes them independently. Each app runs its own EC2 instance, and the 750 free hours/month cover only one.

---

## 4. Copy this toolkit into an existing repository

Copy these into the root of your repository:

```text
infra/          (without infra/.terraform/ and any *.secrets.tfvars)
scripts/
templates/
package.json    (merge the "scripts" and "dependencies" into yours if you already have one)
.github/workflows/deploy.yml   (optional)
.gitattributes  (keeps shell scripts LF on Windows)
```

and append the Terraform/secrets lines of `.gitignore` to yours. Then set `backend_path` / `frontend_path` relative to your repository root and follow [section 2](#2-step-by-step).

---

## 5. Checklist before going live

- [ ] `alert_email` set and both SNS subscriptions confirmed
- [ ] `monthly_budget_usd` set
- [ ] Health endpoint checks the database
- [ ] No secrets in git (`git grep -i "secret\|password\|mongodb+srv"`)
- [ ] `npm run ops -- backup` works and `npm run ops -- backups` lists it (local DB)
- [ ] Tried a rollback once: `npm run ops -- rollback`
- [ ] Custom domain configured if needed ([OPERATIONS.md](OPERATIONS.md#custom-domain))
- [ ] Load-tested the micro instance if you expect traffic (`npx autocannon https://<app>/api/health`) and watched the dashboard
