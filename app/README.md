# GameZone app

The app is split into a React/Vite frontend and an Express/Mongoose backend:

- `frontend/` contains the GameZone booking, account, and admin UI.
- `backend/` contains the `/api` endpoints and MongoDB models.
- `docker-compose.yml` runs MongoDB and the backend for local development.

## Local development

1. Copy `backend/.env.example` to `backend/.env` and set a strong `JWT_SECRET`. Add Razorpay and SMTP values when those features are needed.
2. From this directory, start the database and backend:

   ```sh
   docker compose up --build
   ```

3. In another terminal, start the frontend:

   ```sh
   npm install --prefix frontend
   npm run dev --prefix frontend
   ```

The frontend is served at `http://localhost:3000` and proxies `/api` to the backend on port `5000`.

To run the backend directly instead, start MongoDB, set `MONGO_URI` in `backend/.env`, then run `npm install` and `npm run dev` from `backend/`.

To seed the database, run `npm run seed` from `backend/` after configuring `MONGO_URI`.

## Deployment

The Terraform defaults in `infra/environments/prod.tfvars` use these folders. The backend listens on the injected `PORT`, reports database readiness at `/api/health`, and reads the MongoDB URL from `MONGO_URI`. The frontend uses same-origin `/api` requests, routed to the backend by CloudFront and nginx.

Copy `infra/environments/example.secrets.tfvars` to `infra/environments/prod.secrets.tfvars` and set `JWT_SECRET`, Razorpay credentials, and SMTP credentials there. Never commit `.env` files or real credentials.
