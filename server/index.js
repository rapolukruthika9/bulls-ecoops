import 'dotenv/config';
import { createApp } from './app.js';
import { createGeminiClient } from './services/gemini.js';

const PORT = Number(process.env.PORT) || 3001;
const clean = (v) => (!v || /replace_me/i.test(v) ? '' : v);

const env = { ...process.env, GEMINI_API_KEY: clean(process.env.GEMINI_API_KEY), NLR_API_KEY: clean(process.env.NLR_API_KEY) };
const app = createApp({ env, geminiClient: createGeminiClient(env.GEMINI_API_KEY) });

app.listen(PORT, () => {
  console.log(`BULLS ECOOPS server on http://localhost:${PORT}`);
  console.log(`  Gemini:  ${env.GEMINI_API_KEY ? 'configured' : 'NOT configured (deterministic fallback proposals only)'}`);
  console.log(`  PVWatts: ${env.NLR_API_KEY ? 'configured' : 'NOT configured (capacity-only solar)'}`);
});
