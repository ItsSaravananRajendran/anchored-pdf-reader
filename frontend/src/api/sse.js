/**
 * SSE (Server-Sent Events) helper.
 *
 * The /api/chat endpoint streams events of the form:
 *   event: token\ndata: "<text>"\n\n
 *   event: error\ndata: "<message>"\n\n
 *   event: done\ndata: {}\n\n
 *
 * We parse them as they arrive and dispatch into a typed callback.
 * The caller can abort by calling AbortController.abort().
 */

const DONE = "done";
const TOKEN = "token";
const ERROR = "error";

export async function streamChat({ sessionId, messageId, text, anchor, onToken, onError, onDone, signal }) {
    const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId, message_id: messageId, text, anchor }),
        signal,
    });

    if (!response.ok || !response.body) {
        const text2 = await response.text().catch(() => response.statusText);
        const error = new Error(`chat failed: ${response.status} ${text2}`);
        error.status = response.status;
        throw error;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });

            // SSE events are delimited by blank lines ("\n\n"). Split and process.
            let boundary;
            // eslint-disable-next-line no-cond-assign
            while ((boundary = buffer.indexOf("\n\n")) !== -1) {
                const raw = buffer.slice(0, boundary);
                buffer = buffer.slice(boundary + 2);
                _dispatch(raw, { onToken, onError, onDone });
                if (signal?.aborted) {
                    await reader.cancel();
                    return;
                }
            }
        }
        // Flush any trailing event without a final blank line
        if (buffer.trim()) {
            _dispatch(buffer, { onToken, onError, onDone });
        }
    } catch (err) {
        if (err.name === "AbortError") return;
        throw err;
    }
}

function _dispatch(raw, callbacks) {
    let eventName = "message";
    const dataLines = [];
    for (const line of raw.split("\n")) {
        if (line.startsWith("event:")) {
            eventName = line.slice(6).trim();
        } else if (line.startsWith("data:")) {
            dataLines.push(line.slice(5).trim());
        }
    }
    const data = dataLines.join("\n");

    if (eventName === TOKEN && callbacks.onToken) {
        callbacks.onToken(_unquote(data));
    } else if (eventName === ERROR && callbacks.onError) {
        callbacks.onError(_unquote(data));
    } else if (eventName === DONE && callbacks.onDone) {
        callbacks.onDone();
    }
}

function _unquote(jsonString) {
    try {
        return JSON.parse(jsonString);
    } catch {
        return jsonString;
    }
}