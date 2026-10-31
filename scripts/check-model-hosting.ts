import { verifyProfilingHosting } from "../src/integrations/databricks/model-hosting.server";
const { provenance } = await verifyProfilingHosting(process.env["DATABRICKS_MODEL_ENDPOINT"] ?? "");
console.log(JSON.stringify(provenance));
