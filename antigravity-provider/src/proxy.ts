import { Router, Request, Response } from 'express';
import axios from 'axios';
import { tokenManager } from './tokenManager';

export const proxyRouter = Router();

/**
 * Basic mapper to convert OpenAI messages to Gemini/Antigravity contents format.
 * This is a simplified version of the logic found in Antigravity-Manager's mappers.
 */
function mapMessagesToGemini(messages: any[]) {
    const contents: any[] = [];
    let systemInstruction: any = null;

    for (const msg of messages) {
        if (msg.role === 'system') {
            systemInstruction = {
                parts: [{ text: msg.content }]
            };
        } else {
            contents.push({
                role: msg.role === 'assistant' ? 'model' : 'user',
                parts: [{ text: msg.content }]
            });
        }
    }
    return { contents, systemInstruction };
}
/**
 * Recursively clean JSON Schema for Gemini v1internal.
 * Removes unsupported fields and converts 'type' to uppercase.
 */
function cleanJsonSchema(schema: any) {
    if (!schema || typeof schema !== 'object') return;

    // Remove unsupported fields by Gemini Schema proto
    delete schema.$schema;
    delete schema.$defs;
    delete schema.definitions;
    delete schema.additionalProperties;
    delete schema.strict;

    // v1internal requires 'type' to be uppercase (e.g., 'OBJECT', 'STRING')
    if (schema.type && typeof schema.type === 'string') {
        schema.type = schema.type.toUpperCase();
    } else if (schema.properties && !schema.type) {
        schema.type = 'OBJECT';
    }

    if (schema.properties) {
        for (const key in schema.properties) {
            cleanJsonSchema(schema.properties[key]);
        }
    }
    
    if (schema.items) {
        cleanJsonSchema(schema.items);
    }
}

/**
 * Maps OpenAI tools array to Gemini functionDeclarations
 */
function mapToolsToGemini(tools: any[]) {
    if (!tools || !Array.isArray(tools) || tools.length === 0) return undefined;

    const functionDeclarations = tools
        .filter(t => t.type === 'function' && t.function)
        .map(t => {
            const func = t.function;
            const parameters = func.parameters ? JSON.parse(JSON.stringify(func.parameters)) : { type: 'OBJECT', properties: {} };
            cleanJsonSchema(parameters);
            
            return {
                name: func.name,
                description: func.description || '',
                parameters
            };
        });

    return [{ functionDeclarations }];
}
/**
 * Parses Gemini SSE stream and converts it to OpenAI SSE stream format.
 */
function handleGeminiStreamResponse(geminiStream: any, res: Response, modelId: string) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    geminiStream.on('data', (chunk: Buffer) => {
        const lines = chunk.toString('utf8').split('\n');
        
        for (const line of lines) {
            if (line.trim() === '') continue;
            
            // Antigravity might return data: {...} or just raw JSON depending on the exact upstream endpoint
            // Assuming standard SSE format here
            const dataStr = line.replace(/^data:\s*/, '');
            if (dataStr === '[DONE]') continue;
            
            try {
                const data = JSON.parse(dataStr);
                // Extract text from Gemini structure
                const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
                
                if (text) {
                    const openAiChunk = {
                        id: `chatcmpl-${Date.now()}`,
                        object: 'chat.completion.chunk',
                        created: Math.floor(Date.now() / 1000),
                        model: modelId,
                        choices: [{
                            index: 0,
                            delta: { content: text },
                            finish_reason: null
                        }]
                    };
                    res.write(`data: ${JSON.stringify(openAiChunk)}\n\n`);
                }

                // Check finish reason
                const finishReason = data?.candidates?.[0]?.finishReason;
                if (finishReason) {
                    const mappedFinishReason = finishReason === 'STOP' ? 'stop' : 
                                              finishReason === 'SAFETY' ? 'content_filter' : 'length';
                    
                    const finalChunk = {
                        id: `chatcmpl-${Date.now()}`,
                        object: 'chat.completion.chunk',
                        created: Math.floor(Date.now() / 1000),
                        model: modelId,
                        choices: [{
                            index: 0,
                            delta: {},
                            finish_reason: mappedFinishReason
                        }]
                    };
                    res.write(`data: ${JSON.stringify(finalChunk)}\n\n`);
                    res.write('data: [DONE]\n\n');
                }
            } catch (err) {
                // Ignore parsing errors for partial chunks
                // A robust implementation requires an SSE chunk accumulator
            }
        }
    });

    geminiStream.on('end', () => {
        res.end();
    });

    geminiStream.on('error', (err: any) => {
        console.error('[Proxy] Stream error:', err);
        res.end();
    });
}

/**
 * Handle OpenAI /v1/chat/completions requests
 */
proxyRouter.post('/chat/completions', async (req: Request, res: Response) => {
    const { model, messages, temperature, top_p, stream, tools } = req.body;

    try {
        // 1. Get an active token from the pool
        const accessToken = await tokenManager.getAvailableToken();

        // 2. Map request to Gemini format
        const { contents, systemInstruction } = mapMessagesToGemini(messages);
        const mappedTools = mapToolsToGemini(tools);
        
        const geminiPayload: any = {
            contents,
            generationConfig: {
                temperature: temperature ?? 1.0,
                topP: top_p ?? 0.95,
            }
        };

        if (systemInstruction) {
            geminiPayload.systemInstruction = systemInstruction;
        }
        
        if (mappedTools) {
            geminiPayload.tools = mappedTools;
        }

        // 3. Send request to Upstream
        // Use Antigravity (Cloud Code) internal endpoints instead of public Gemini API
        // Fallback order: sandbox -> daily -> prod
        const baseUrl = 'https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal';
        
        // Ensure model name is properly formatted. In Antigravity, model is usually passed inside the payload
        // or handled by the backend's routing. For cloudcode-pa, the URL is just :method.
        // We set the model in the geminiPayload instead of the URL.
        const actualModel = (model.includes('gemini') ? model : 'gemini-1.5-pro-latest').replace(/^models\//, '');
        
        // cloudcode-pa endpoint expects a specific root structure
        const cloudCodePayload = {
            project: 'antigravity-provider', // can be arbitrary for sandbox
            request: geminiPayload, // contents, generationConfig, etc.
            model: actualModel,
            userAgent: 'antigravity',
            requestType: 'agent',
            requestId: `agent/antigravity/${Math.random().toString(36).substring(7)}/1`
        };

        const method = stream ? 'streamGenerateContent?alt=sse' : 'generateContent';
        const url = `${baseUrl}:${method}`;

        // 3. Send request to Upstream
        const upstreamReq = await axios.post(url, cloudCodePayload, {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
                'x-client-name': 'antigravity',
                'x-client-version': '1.0.0',
                'x-machine-id': Math.random().toString(36).substring(2),
                'x-vscode-sessionid': Math.random().toString(36).substring(2),
                'User-Agent': 'antigravity'
            },
            responseType: stream ? 'stream' : 'json'
        });

        // 4. Map and send Response
        if (stream) {
            handleGeminiStreamResponse(upstreamReq.data, res, actualModel);
        } else {
            const data = upstreamReq.data;
            const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
            const finishReason = data?.candidates?.[0]?.finishReason === 'STOP' ? 'stop' : 'length';

            const openAiResponse = {
                id: `chatcmpl-${Date.now()}`,
                object: 'chat.completion',
                created: Math.floor(Date.now() / 1000),
                model: actualModel,
                choices: [{
                    index: 0,
                    message: {
                        role: 'assistant',
                        content: text
                    },
                    finish_reason: finishReason
                }],
                usage: {
                    prompt_tokens: 0,
                    completion_tokens: 0,
                    total_tokens: 0
                }
            };

            res.json(openAiResponse);
        }

    } catch (error: any) {
        console.error('[Proxy] Error forwarding request:', error.response?.data || error.message);
        
        // Handle 401/403 which might indicate an invalid token
        if (error.response?.status === 401 || error.response?.status === 403) {
            console.error('[Proxy] Account might be blocked or token is completely invalid.');
            // A production app should flag this account in DB to avoid retrying
        }

        res.status(error.response?.status || 500).json({
            error: {
                message: 'Failed to process request upstream',
                type: 'upstream_error',
                code: error.response?.status
            }
        });
    }
});
