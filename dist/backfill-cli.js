import { openDb, initSchema } from "./db.js";
import { backfill } from "./backfill.js";
const args = process.argv.slice(2);
const projectArg = args.find((a) => a.startsWith("--project="))?.split("=")[1];
const limitArg = args.find((a) => a.startsWith("--limit="))?.split("=")[1];
const db = openDb();
initSchema(db);
backfill({
    db,
    options: {
        project: projectArg,
        limit: limitArg ? parseInt(limitArg, 10) : undefined,
        log: (msg) => process.stderr.write(`${new Date().toISOString()} ${msg}\n`),
    },
})
    .then((result) => {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    db.close();
})
    .catch((err) => {
    process.stderr.write(`fatal: ${err}\n`);
    process.exit(1);
});
//# sourceMappingURL=backfill-cli.js.map