import { Injectable, Logger } from '@nestjs/common';
import { Server } from 'socket.io';
import { ILlmProvider } from '../../llm/interfaces/llm-provider.interface';
import { LlmChatRequest, LlmToolCall } from '../../llm/dto/llm.dto';
import { ServerEvents } from '../../websocket/interfaces/ws-events.enum';

export interface StreamResult {
  fullText: string;
  toolCalls: LlmToolCall[];
  ttftMs: number | null;
}

/**
 * StreamingProxyService
 *
 * Drives ILlmProvider.stream() and fans out token events to a Socket.io room.
 *
 * Behaviour:
 *  - Text tokens   → emit ServerEvents.MESSAGE_CHUNK to the room in real time
 *  - Tool calls    → buffered silently (NOT streamed) until the full JSON is assembled
 *  - WS room empty → continue accumulating for persistence (visitor may reconnect)
 *
 * The caller receives { fullText, toolCalls } and is responsible for:
 *  1. Persisting the assistant message
 *  2. Executing tool calls via SkillExecutorService
 *  3. Emitting ServerEvents.MESSAGE_COMPLETE
 */
@Injectable()
export class StreamingProxyService {
  private readonly logger = new Logger(StreamingProxyService.name);

  /**
   * Stream an LLM response into a WebSocket room.
   *
   * @param llmProvider  Injected LLM provider (OpenAI or any swap)
   * @param request      The assembled chat request
   * @param room         Socket.io room name — 'conversation:<id>'
   * @param server       Socket.io server instance (injected from gateway)
   */
  async streamToRoom(
    llmProvider: ILlmProvider,
    request: LlmChatRequest,
    room: string,
    server: Server,
  ): Promise<StreamResult> {
    let fullText = '';
    let ttftMs: number | null = null;
    const start = Date.now();

    // Tool call accumulator keyed by delta index
    const toolCallBuffers = new Map<
      number,
      { id: string; name: string; args: string }
    >();

    for await (const chunk of llmProvider.stream(request)) {
      // ── Text delta ────────────────────────────────────────────────────
      if (chunk.delta) {
        if (ttftMs === null) ttftMs = Date.now() - start;

        fullText += chunk.delta;

        // Emit to room — if room is empty the emit is a no-op
        server.to(room).emit(ServerEvents.MESSAGE_CHUNK, { token: chunk.delta });
      }

      // ── Tool call delta (buffered, never streamed) ────────────────────
      if (chunk.toolCallDelta) {
        const { index, id, name, argumentsDelta } = chunk.toolCallDelta;
        if (!toolCallBuffers.has(index)) {
          toolCallBuffers.set(index, { id: '', name: '', args: '' });
        }
        const buf = toolCallBuffers.get(index)!;
        if (id) buf.id = id;
        if (name) buf.name += name;
        if (argumentsDelta) buf.args += argumentsDelta;
      }
    }

    // Assemble complete tool calls in order
    const toolCalls: LlmToolCall[] = [...toolCallBuffers.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, buf]) => ({
        id: buf.id,
        type: 'function' as const,
        function: { name: buf.name, arguments: buf.args },
      }));

    this.logger.debug(
      `Stream complete — room=${room} tokens=${fullText.length} ` +
      `toolCalls=${toolCalls.length} ttft=${ttftMs ?? 'n/a'}ms`,
    );

    return { fullText, toolCalls, ttftMs };
  }
}
