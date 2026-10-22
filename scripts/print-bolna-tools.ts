// Prints the four custom-function definitions in the dashboard's format, for adding them by hand
// in the agent's Tools tab. Usage: npm run bolna:tools   (npm run bolna:setup does this automatically)
import "dotenv/config";
import { buildTools } from "./bolnaConfig";

const tools = buildTools(process.env.PUBLIC_URL || "https://YOUR-SERVER.example.com", process.env.TOOLS_TOKEN);
for (const t of tools) {
  console.log(`\n// ----- ${t.name} -----`);
  console.log(JSON.stringify(t, null, 2));
}
