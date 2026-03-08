/**
 * MCP Server — exposes all CDP tools via the Model Context Protocol.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { tools, executeTool } from '../cdp/tools.js';
import { logger } from '../utils/logger.js';

/**
 * Create and start the MCP server over stdio.
 */
export async function startMCPServer() {
    const server = new McpServer({
        name: 'kuskus-cdp',
        version: '1.0.0',
    });

    // Register all CDP tools
    for (const [name, tool] of Object.entries(tools)) {
        logger.mcp(`Registering tool: ${name}`);

        server.tool(
            name,
            tool.description,
            tool.schema.shape,  // pass Zod shape for schema
            async (params) => {
                logger.mcp(`Tool called: ${name}`, params);
                try {
                    const result = await executeTool(name, params);

                    // Handle screenshot tool — return image content
                    if (result.screenshot) {
                        return {
                            content: [
                                {
                                    type: 'image',
                                    data: result.screenshot,
                                    mimeType: result.mimeType || 'image/png',
                                },
                            ],
                        };
                    }

                    // All other tools — return text content
                    return {
                        content: [
                            {
                                type: 'text',
                                text: JSON.stringify(result, null, 2),
                            },
                        ],
                    };
                } catch (err) {
                    logger.error(`Tool ${name} failed:`, err.message);
                    return {
                        content: [
                            {
                                type: 'text',
                                text: JSON.stringify({ error: err.message }),
                            },
                        ],
                        isError: true,
                    };
                }
            }
        );
    }

    // Start stdio transport
    const transport = new StdioServerTransport();
    logger.mcp('Starting MCP server on stdio');
    await server.connect(transport);
    logger.mcp('MCP server connected');

    return server;
}
