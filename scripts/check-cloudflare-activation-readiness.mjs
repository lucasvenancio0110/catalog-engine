import { checkCloudflareActivationReadiness } from './cloudflare-readiness-core.mjs';

const result = await checkCloudflareActivationReadiness();
console.log(JSON.stringify(result, null, 2));
if (!result.readyForControlledActivation) process.exitCode = 2;
