// Runs once, when MongoDB initialises an empty data directory (first start on a new volume).
// Creates the least-privilege user the backend connects with: readWrite on its own database
// only. The root user (MONGO_INITDB_ROOT_*) is used for backups and administration.
const database = process.env.MONGO_APP_DATABASE;
const user = process.env.MONGO_APP_USERNAME;
const password = process.env.MONGO_APP_PASSWORD;

if (!database || !user || !password) {
  throw new Error('MONGO_APP_DATABASE, MONGO_APP_USERNAME and MONGO_APP_PASSWORD must be set');
}

db.getSiblingDB(database).createUser({
  user,
  pwd: password,
  roles: [{ role: 'readWrite', db: database }],
});

print(`Created MongoDB user "${user}" with readWrite on "${database}"`);
