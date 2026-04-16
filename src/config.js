/**
 * Configuration — all settings from environment variables with sensible defaults.
 */

export const config = {
    // Browser
    headless: env('KUSKUS_HEADLESS', 'true') === 'true',
    cdpPort: parseInt(env('KUSKUS_CDP_PORT', '9222'), 10),
    chromePath: env('KUSKUS_CHROME_PATH', ''),
    viewport: {
        width: parseInt(env('KUSKUS_VIEWPORT_WIDTH', '1280'), 10),
        height: parseInt(env('KUSKUS_VIEWPORT_HEIGHT', '720'), 10),
    },

    // OpenAI
    openaiApiKey: env('OPENAI_API_KEY', ''),
    openaiModel: env('KUSKUS_MODEL', 'gpt-4o-mini'),

    // Timeouts
    navigationTimeout: parseInt(env('KUSKUS_NAV_TIMEOUT', '30000'), 10),
    toolTimeout: parseInt(env('KUSKUS_TOOL_TIMEOUT', '15000'), 10),

    // Navigation wait strategy: domcontentloaded | load | networkidle0 | networkidle2
    waitUntil: env('KUSKUS_WAIT_UNTIL', 'domcontentloaded'),

    // Debug
    debug: env('KUSKUS_DEBUG', 'false') === 'true',

    // Agent
    maxAgentSteps: parseInt(env('KUSKUS_MAX_STEPS', '25'), 10),
};

function env(key, fallback) {
    return process.env[key] ?? fallback;
}
