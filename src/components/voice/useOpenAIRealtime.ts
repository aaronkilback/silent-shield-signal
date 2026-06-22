import { useState, useRef, useCallback, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/hooks/useTenant';
import { useClientSelection } from '@/hooks/useClientSelection';

interface UseOpenAIRealtimeOptions {
  onTranscript?: (text: string, isFinal: boolean) => void;
  onAgentResponse?: (text: string) => void;
  onAgentResponseComplete?: (fullText: string) => void;
  onError?: (error: string) => void;
  onStatusChange?: (status: 'idle' | 'connecting' | 'connected' | 'speaking' | 'listening' | 'thinking') => void;
  onToolCall?: (toolName: string, args: Record<string, unknown>) => void;
  agentContext?: string;
  conversationHistory?: Array<{ role: string; content: string }>;
}

export function useOpenAIRealtime(options: UseOpenAIRealtimeOptions = {}) {
  const [status, setStatus] = useState<'idle' | 'connecting' | 'connected' | 'speaking' | 'listening' | 'thinking'>('idle');
  const statusRef = useRef(status);
  const [isAgentSpeaking, setIsAgentSpeaking] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [agentResponse, setAgentResponse] = useState('');
  // Manual mic mute — operator toggles the mic off during a side conversation
  // without ending the session. Distinct from the auto-mute that only holds
  // while Aegis is speaking. userMutedRef mirrors isMuted for use in handlers.
  const [isMuted, setIsMuted] = useState(false);
  const userMutedRef = useRef(false);
  // P1-A: TRUE microphone-readiness for the UI — reflects the actual half-duplex transport
  // gate (mic track live + listening), NOT inferred response status. false from
  // closeInputGate() until openInputGate() genuinely re-enables the track.
  const [inputReady, setInputReady] = useState(false);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioElementRef = useRef<HTMLAudioElement | null>(null);
  const connectTimeoutRef = useRef<number | null>(null);
  const greetTimeoutRef = useRef<number | null>(null);
  const responseFallbackRef = useRef<number | null>(null);
  const userHasSpokenRef = useRef(false);
  const greetedRef = useRef(false);
  // Voice Recovery (client-owned turns, Option B): the client is the SOLE owner of
  // response.create (token sets server_vad.create_response:false). These refs enforce
  // single ownership so two response-creation paths can never race.
  const responseActiveRef = useRef(false);   // true between response.created and response.done
  const responsePendingRef = useRef(false);  // true between our send and response.created
  const queuedResponseRef = useRef<{ reason: string; response: unknown } | null>(null); // tool continuation
  const lastAcceptedTranscriptRef = useRef<{ text: string; at: number }>({ text: '', at: 0 });
  // Half-Duplex Gate: while CLOSED, Aegis owns the channel — the mic track is disabled
  // (no audio content transmitted) AND every transcript is discarded before any render/
  // persist/response. Reopened only after a deterministic post-output tail. gateGenRef is a
  // monotonic id so a stale reopen timer can never reopen the mic during a newer response.
  const POST_OUTPUT_TAIL_MS = 1500;
  const inputGateOpenRef = useRef(true);
  const gateGenRef = useRef(0);
  const gateReopenRef = useRef<number | null>(null);
  
  // Use ref for options to avoid stale closures in event handlers
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  // P0 voice containment (2026-06-11): voice-tool-executor-v2 fails closed and
  // returns NO data unless it receives a validated tenant_id + client_id. Pass
  // the operator's CURRENT tenant + selected client on every tool call so voice
  // can only ever read the selected client's data. Held in a ref so the
  // tool-call handler reads the latest selection without re-binding.
  const { currentTenant } = useTenant();
  const { selectedClientId } = useClientSelection();
  const voiceScopeRef = useRef<{ tenantId: string | null; clientId: string | null }>({ tenantId: null, clientId: null });
  useEffect(() => {
    voiceScopeRef.current = { tenantId: currentTenant?.id ?? null, clientId: selectedClientId ?? null };
  }, [currentTenant?.id, selectedClientId]);

  const updateStatus = useCallback((newStatus: typeof status) => {
    statusRef.current = newStatus;
    setStatus(newStatus);
    optionsRef.current.onStatusChange?.(newStatus);
  }, []);

  // Half-Duplex Gate helpers (idempotent).
  // closeInputGate: synchronously stop the mic from transmitting audio + bump generation +
  // cancel any pending reopen. Called before every gateway-owned response.create send.
  const closeInputGate = useCallback((reason: string) => {
    inputGateOpenRef.current = false;
    gateGenRef.current += 1;
    if (gateReopenRef.current) { window.clearTimeout(gateReopenRef.current); gateReopenRef.current = null; }
    mediaStreamRef.current?.getAudioTracks().forEach(t => { t.enabled = false; });
    setInputReady(false); // UI: not ready to speak
    console.log(`[Voice][gate] CLOSED @${Math.round(performance.now())}ms (gen ${gateGenRef.current}): ${reason} — inputReady=false`);
  }, []);

  // openInputGate: re-enable mic transport + transcript acceptance + listening (unless the
  // operator manually muted or the session ended).
  const openInputGate = useCallback((reason: string) => {
    if (gateReopenRef.current) { window.clearTimeout(gateReopenRef.current); gateReopenRef.current = null; }
    inputGateOpenRef.current = true;
    // inputReady becomes true ONLY when the mic track is actually live + listening (not idle,
    // not manually muted). The UI keys "ready to speak" off this, never off raw status.
    const micLive = statusRef.current !== 'idle' && !userMutedRef.current;
    if (micLive) {
      mediaStreamRef.current?.getAudioTracks().forEach(t => { t.enabled = true; });
      updateStatus('listening');
    }
    setInputReady(micLive);
    console.log(`[Voice][gate] OPEN @${Math.round(performance.now())}ms: ${reason} — inputReady=${micLive}`);
  }, [updateStatus]);

  // scheduleInputGateOpen: reopen only after a deterministic post-output tail, and only if
  // no newer response has since closed the gate (generation check) and none is active.
  const scheduleInputGateOpen = useCallback((reason: string) => {
    const myGen = gateGenRef.current;
    if (gateReopenRef.current) window.clearTimeout(gateReopenRef.current);
    gateReopenRef.current = window.setTimeout(() => {
      gateReopenRef.current = null;
      if (gateGenRef.current !== myGen) { console.log('[Voice] stale gate-reopen ignored'); return; }
      if (responseActiveRef.current) { console.log('[Voice] gate-reopen deferred (response active)'); return; }
      openInputGate(`tail-elapsed: ${reason}`);
    }, POST_OUTPUT_TAIL_MS);
  }, [openInputGate]);

  // Voice Recovery: THE single response gateway. Every client-originated response.create
  // (voice turn, greeting, typed message, tool continuation) MUST go through here. It
  // refuses a send when a response is already active/pending or the session is gone, so
  // we can never trigger "Conversation already has an active response in progress". Tool
  // continuations may queue (queueIfBusy) and fire on the next response.done.
  const requestResponse = useCallback((reason: string, opts?: { response?: unknown; queueIfBusy?: boolean }): boolean | 'queued' => {
    const dc = dcRef.current;
    if (!dc || dc.readyState !== 'open') { console.log(`[Voice] requestResponse refused (disconnected): ${reason}`); return false; }
    if (responseActiveRef.current || responsePendingRef.current) {
      if (opts?.queueIfBusy) {
        queuedResponseRef.current = { reason, response: opts?.response ?? null };
        console.log(`[Voice] requestResponse queued (busy): ${reason}`);
        return 'queued';
      }
      console.log(`[Voice] requestResponse refused (busy): ${reason}`);
      return false;
    }
    // Half-duplex: close the input gate SYNCHRONOUSLY before the response.create send, so the
    // mic stops transmitting the instant we commit to a response (covers the pre-audio window).
    closeInputGate(`pre-response.create: ${reason}`);
    responsePendingRef.current = true;
    dc.send(JSON.stringify(opts?.response ? { type: 'response.create', response: opts.response } : { type: 'response.create' }));
    console.log(`[Voice] requestResponse sent: ${reason}`);
    return true;
  }, [closeInputGate]);

  // Execute a tool and send result back to OpenAI
  const executeToolCall = useCallback(async (
    callId: string, 
    toolName: string, 
    toolArgs: Record<string, unknown>
  ) => {
    console.log(`[Voice] Executing tool: ${toolName}`, toolArgs);
    updateStatus('thinking');
    optionsRef.current.onToolCall?.(toolName, toolArgs);
    
    try {
      const { data, error } = await supabase.functions.invoke('voice-tool-executor-v2', {
        body: {
          tool_name: toolName,
          arguments: toolArgs,
          tenant_id: voiceScopeRef.current.tenantId,
          client_id: voiceScopeRef.current.clientId,
        }
      });
      
      if (error) throw error;
      
      const resultStr = JSON.stringify(data?.result || { error: 'No result' });
      console.log(`[Voice] Tool result:`, resultStr.substring(0, 200));
      
      // Send function result back to OpenAI
      if (dcRef.current?.readyState === 'open') {
        console.log('[Voice] Sending function output back to OpenAI...');
        
        // Create conversation item with function output
        const outputEvent = {
          type: 'conversation.item.create',
          item: {
            type: 'function_call_output',
            call_id: callId,
            output: resultStr
          }
        };
        console.log('[Voice] Output event:', JSON.stringify(outputEvent));
        dcRef.current.send(JSON.stringify(outputEvent));

        // Small delay to ensure the item is created before requesting response
        await new Promise(resolve => setTimeout(resolve, 100));

        // Trigger response generation via the single gateway. queueIfBusy: the tool-call
        // response that requested this tool may not have emitted response.done yet; queue
        // and let response.done fire the continuation. Exactly one continuation results.
        requestResponse('tool-continuation', { queueIfBusy: true });
      } else {
        console.error('[Voice] Data channel not open, cannot send function output');
      }
    } catch (err) {
      console.error('[Voice] Tool execution error:', err);
      
      // Send error result back
      if (dcRef.current?.readyState === 'open') {
        dcRef.current.send(JSON.stringify({
          type: 'conversation.item.create',
          item: {
            type: 'function_call_output',
            call_id: callId,
            output: JSON.stringify({ error: 'Tool execution failed' })
          }
        }));

        requestResponse('tool-continuation-error', { queueIfBusy: true });
      }
    }
  }, [updateStatus, requestResponse]);

  const handleRealtimeEvent = useCallback((event: Record<string, unknown>) => {
    console.log('Realtime event:', event.type, event);

    switch (event.type) {
      case 'session.created':
        console.log('Session created');
        break;

      case 'session.updated':
        console.log('Session updated');
        break;

      case 'input_audio_buffer.speech_started':
        // If the user starts talking quickly after connect, don't fire the proactive greeting
        userHasSpokenRef.current = true;
        if (greetTimeoutRef.current) {
          window.clearTimeout(greetTimeoutRef.current);
          greetTimeoutRef.current = null;
        }
        // Clear any pending fallback since user is speaking again
        if (responseFallbackRef.current) {
          window.clearTimeout(responseFallbackRef.current);
          responseFallbackRef.current = null;
        }
        updateStatus('listening');
        setIsAgentSpeaking(false);
        break;

      case 'input_audio_buffer.speech_stopped':
        console.log('User stopped speaking, waiting for transcription...');
        // Client-owned turns: server VAD does NOT auto-create a response
        // (create_response:false). We wait for transcription.completed, validate it, then
        // send exactly one response.create via the gateway. NO timer-based fallback — that
        // 3s fallback was the confirmed source of the iPhone "active response" race.
        updateStatus('thinking');
        break;
      
      case 'input_audio_buffer.committed':
        console.log('Audio buffer committed to server');
        updateStatus('thinking');
        break;

      case 'conversation.item.input_audio_transcription.completed':
        {
          const transcriptText = (event as Record<string, unknown>).transcript as string;
          // HALF-DUPLEX ACCEPTANCE GATE (top, before anything else): while Aegis owns the
          // channel, a leaked echo transcript must produce ZERO render/persist/response.
          // Discard if the input gate is closed, a response is active, or a post-output
          // tail reopen is still pending.
          if (!inputGateOpenRef.current || responseActiveRef.current || gateReopenRef.current !== null) {
            console.log('[Voice] transcript DISCARDED (input gate closed):', JSON.stringify(transcriptText));
            break;
          }
          // Whisper hallucinates stock phrases on silence/echo ("thank you for watching",
          // "we'll see you next time", "peace", bare "you", "bye bye"). Drop these and
          // cancel any auto-created response so Aegis never replies to a phantom turn.
          // NOTE: only non-command filler is filtered — real short answers (yes/no/yeah/
          // stop/ok) are intentionally NOT in the list.
          const norm = (transcriptText || '').trim().toLowerCase().replace(/[.!?,]+/g, '').trim();
          const HALLUCINATIONS = new Set([
            '', 'you', 'thank you', 'thanks', 'thank you very much', 'peace', 'bye',
            'goodbye', 'thank you for watching', 'thanks for watching', 'please subscribe',
            "we'll see you next time", 'see you next time', 'like and subscribe',
            'thanks for watching!', 'subscribe', 'bye bye',
          ]);
          const isHallucination = !norm || norm.length < 2 || HALLUCINATIONS.has(norm)
            || norm.startsWith('thank you for watching') || norm.startsWith('thanks for watching')
            || norm.startsWith('please subscribe') || norm.startsWith("we'll see you");
          // Client-owned turns: a REJECTED transcript simply creates no response. Because
          // the server no longer auto-responds (create_response:false), there is nothing to
          // cancel — so NO response.cancel, NO onTranscript, NO persistence/render. Recover
          // cleanly to listening.
          if (isHallucination) {
            console.log('[Voice] Dropped likely hallucinated/empty transcript (no response created):', JSON.stringify(transcriptText));
            if (statusRef.current !== 'speaking') updateStatus('listening');
            break;
          }
          // Duplicate guard: ignore an identical transcript repeated within 4s (prevents
          // duplicate user-turn render + a second response).
          const nowTs = Date.now();
          if (norm === lastAcceptedTranscriptRef.current.text && (nowTs - lastAcceptedTranscriptRef.current.at) < 4000) {
            console.log('[Voice] Ignored duplicate transcript:', JSON.stringify(transcriptText));
            break;
          }
          lastAcceptedTranscriptRef.current = { text: norm, at: nowTs };
          console.log('User transcript accepted:', transcriptText);
          setTranscript(transcriptText);
          optionsRef.current.onTranscript?.(transcriptText, true);
          // Exactly one response for this accepted turn, via the gateway.
          requestResponse('voice-turn');
        }
        break;

      case 'response.function_call_arguments.done':
        {
          // Function call is complete, execute it
          // Note: The event structure may have the call_id at different levels
          const callId = (event.call_id || (event as any).item?.call_id) as string;
          const name = (event.name || (event as any).item?.name) as string;
          const argsStr = (event.arguments || (event as any).item?.arguments) as string;
          
          console.log(`[Voice] Function call received - callId: ${callId}, name: ${name}, args: ${argsStr}`);
          
          if (!callId || !name) {
            console.error('[Voice] Missing call_id or name in function call event:', event);
            break;
          }
          
          try {
            const args = JSON.parse(argsStr || '{}');
            executeToolCall(callId, name, args);
          } catch (e) {
            console.error('[Voice] Failed to parse function args:', e, argsStr);
          }
        }
        break;

      case 'response.output_audio_transcript.delta': // GA
      case 'response.audio_transcript.delta': // beta (back-compat)
        {
          const delta = (event as Record<string, unknown>).delta as string;
          console.log('Agent response delta:', delta);
          setAgentResponse(prev => prev + delta);
          optionsRef.current.onAgentResponse?.(delta);
        }
        break;

      case 'response.output_audio_transcript.done': // GA
      case 'response.audio_transcript.done': // beta (back-compat)
        {
          // Full transcript is complete - notify with final text
          const fullTranscript = (event as Record<string, unknown>).transcript as string;
          console.log('Agent finished speaking, full transcript:', fullTranscript);
          // Call a new callback for the complete response
          optionsRef.current.onAgentResponseComplete?.(fullTranscript || '');
        }
        break;

      case 'response.created':
        // A response is now live (ours, via the gateway). Mark ownership so the gateway
        // refuses any concurrent create. The input gate is already closed (closeInputGate
        // ran in requestResponse, bumping the generation so any prior reopen timer is void).
        responseActiveRef.current = true;
        responsePendingRef.current = false;
        break;

      case 'response.output_audio.delta': // GA
      case 'response.audio.delta': // beta (back-compat)
        // Aegis is speaking. Belt-and-suspenders ownership (in case response.created was
        // missed). Mute the mic while speaking so it can't capture the playback.
        responseActiveRef.current = true;
        responsePendingRef.current = false;
        mediaStreamRef.current?.getAudioTracks().forEach(t => { t.enabled = false; });
        setIsAgentSpeaking(true);
        updateStatus('speaking');
        break;

      case 'response.output_audio.done': // GA
      case 'response.audio.done': // beta (back-compat)
        // Audio generation finished; the device playout tail may still be sounding. Keep the
        // gate CLOSED — reopening is owned by response.done's deterministic tail timer.
        setIsAgentSpeaking(false);
        updateStatus('connected');
        break;

      case 'response.done':
        // Response fully complete: release response ownership. The input gate STAYS CLOSED
        // and reopens only after the deterministic POST_OUTPUT_TAIL_MS (1500ms) tail.
        responseActiveRef.current = false;
        responsePendingRef.current = false;
        setIsAgentSpeaking(false);
        updateStatus('connected');
        setAgentResponse('');
        // Fire any queued continuation (e.g. tool result mid-response) — it re-closes the gate.
        if (queuedResponseRef.current) {
          const q = queuedResponseRef.current;
          queuedResponseRef.current = null;
          requestResponse(q.reason, { response: q.response ?? undefined });
        } else {
          scheduleInputGateOpen('response.done');
        }
        break;

      case 'error':
        {
          const errorData = (event as Record<string, unknown>).error as Record<string, unknown>;
          console.error('Realtime error:', errorData);
          // Recover the gateway AND the mic so a failed/empty response can never wedge the
          // gate closed permanently: clear pending/active and schedule the normal tail reopen.
          responsePendingRef.current = false;
          responseActiveRef.current = false;
          scheduleInputGateOpen('error-recovery');
          optionsRef.current.onError?.(errorData?.message as string || 'Unknown error');
        }
        break;

      default:
        // Log unhandled events for debugging
        if (event.type && !(event.type as string).startsWith('rate_limits')) {
          console.log('Unhandled event type:', event.type);
        }
    }
  }, [updateStatus, executeToolCall, requestResponse, scheduleInputGateOpen]);

  const disconnect = useCallback(() => {
    console.log('Disconnecting...');

    if (connectTimeoutRef.current) {
      window.clearTimeout(connectTimeoutRef.current);
      connectTimeoutRef.current = null;
    }

    if (greetTimeoutRef.current) {
      window.clearTimeout(greetTimeoutRef.current);
      greetTimeoutRef.current = null;
    }

    if (responseFallbackRef.current) {
      window.clearTimeout(responseFallbackRef.current);
      responseFallbackRef.current = null;
    }

    // Voice Recovery + Half-Duplex Gate: reset response-ownership + gate state so a fresh
    // session starts clean and no stale reopen timer can fire.
    if (gateReopenRef.current) {
      window.clearTimeout(gateReopenRef.current);
      gateReopenRef.current = null;
    }
    gateGenRef.current += 1;            // invalidate any in-flight reopen timer
    inputGateOpenRef.current = true;    // next session starts with the gate open
    responseActiveRef.current = false;
    responsePendingRef.current = false;
    queuedResponseRef.current = null;
    lastAcceptedTranscriptRef.current = { text: '', at: 0 };
    setInputReady(false); // UI: not ready until a live session re-opens the gate

    // Close data channel
    if (dcRef.current) {
      dcRef.current.close();
      dcRef.current = null;
    }

    // Close peer connection
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }

    // Stop media stream
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
      mediaStreamRef.current = null;
    }

    // Clean up audio element
    if (audioElementRef.current) {
      audioElementRef.current.pause?.();
      audioElementRef.current.srcObject = null;
      audioElementRef.current.remove();
      audioElementRef.current = null;
    }

    // Close audio context
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }

    userHasSpokenRef.current = false;
    greetedRef.current = false;

    setTranscript('');
    setAgentResponse('');
    setIsAgentSpeaking(false);
    updateStatus('idle');
  }, [updateStatus]);

  const connect = useCallback(async () => {
    try {
      // getUserMedia + autoplay often require user gesture on some browsers,
      // so if connect is called without a click/tap it may fail.
      updateStatus('connecting');
      console.log('Requesting ephemeral token...');

      if (connectTimeoutRef.current) {
        window.clearTimeout(connectTimeoutRef.current);
      }
      connectTimeoutRef.current = window.setTimeout(() => {
        console.warn('Realtime voice connection timed out');
        optionsRef.current.onError?.('Voice connection timed out. Tap mic to try again.');
        disconnect();
      }, 15000);

      // Get ephemeral token from our edge function
      const { data: tokenData, error: tokenError } = await supabase.functions.invoke('openai-realtime-token', {
        body: {
          agentContext: optionsRef.current.agentContext,
          conversationHistory: optionsRef.current.conversationHistory
        }
      });

      if (tokenError || !tokenData?.client_secret) {
        throw new Error(tokenError?.message || 'Failed to get ephemeral token');
      }

      console.log('Got ephemeral token, session:', tokenData.session_id);
      const ephemeralKey = tokenData.client_secret.value;

      // Create RTCPeerConnection
      const pc = new RTCPeerConnection();
      pcRef.current = pc;

      pc.oniceconnectionstatechange = () => {
        console.log('ICE state:', pc.iceConnectionState);
        if (pc.iceConnectionState === 'failed') {
          optionsRef.current.onError?.('Voice connection failed (ICE).');
          disconnect();
        }
      };
      pc.onconnectionstatechange = () => {
        console.log('Peer connection state:', pc.connectionState);
        if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
          optionsRef.current.onError?.('Voice connection lost.');
          disconnect();
        }
      };

      // Set up audio element for playback
      const audioEl = document.createElement('audio');
      audioEl.autoplay = true;
      (audioEl as any).playsInline = true;
      audioEl.setAttribute('playsinline', 'true');
      audioEl.muted = false;
      audioEl.volume = 1;
      audioElementRef.current = audioEl;
      // Append to DOM to improve autoplay reliability on some browsers
      document.body.appendChild(audioEl);

      pc.ontrack = (event) => {
        console.log('Received audio track from OpenAI');
        audioEl.srcObject = event.streams[0];
        audioEl.play().catch((err) => {
          console.warn('Audio autoplay blocked, waiting for user gesture...', err);
          optionsRef.current.onError?.('Audio playback blocked by browser. Tap once to enable sound.');
          const resume = () => {
            audioEl.play().catch(() => {});
          };
          window.addEventListener('pointerdown', resume, { once: true });
        });
      };

      // Get microphone access
      console.log('Requesting microphone access...');
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          sampleRate: 24000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        } 
      });
      mediaStreamRef.current = stream;

      // Add microphone track to peer connection
      stream.getTracks().forEach(track => {
        pc.addTrack(track, stream);
      });

      // Create data channel for events
      const dc = pc.createDataChannel('oai-events');
      dcRef.current = dc;

      dc.onopen = () => {
        console.log('Data channel opened');
        if (connectTimeoutRef.current) {
          window.clearTimeout(connectTimeoutRef.current);
          connectTimeoutRef.current = null;
        }
        updateStatus('connected');

        // Reset per-session greeting state
        userHasSpokenRef.current = false;
        greetedRef.current = false;

        // Proactively greet the user when connection is established (only if they haven't started talking)
        greetTimeoutRef.current = window.setTimeout(() => {
          if (greetedRef.current) return;
          if (userHasSpokenRef.current) return;
          if (dc.readyState !== 'open') return;

          greetedRef.current = true;
          console.log('Sending proactive greeting request...');
          // Greeting goes through the SAME gateway, which closes the input gate before the
          // send — so the mic is held closed through the greeting + its 1500ms tail, then
          // reopened by response.done. No separate mic toggle needed.
          requestResponse('greeting', {
            response: {
              output_modalities: ['audio'],
              instructions:
                'Greet the user briefly. Say something like "Aegis here. How can I help?" Keep it under 10 words.',
            },
          });
        }, 500);
      };

      dc.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          handleRealtimeEvent(data);
        } catch (e) {
          console.error('Failed to parse realtime event:', e);
        }
      };

      dc.onerror = (error) => {
        console.error('Data channel error:', error);
        optionsRef.current.onError?.('Data channel error');
      };

      dc.onclose = () => {
        console.log('Data channel closed');
        updateStatus('idle');
      };

      // Create and set local description
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      // Send offer to OpenAI and get answer
      console.log('Sending SDP offer to OpenAI...');
      const sdpResponse = await fetch('https://api.openai.com/v1/realtime/calls', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${ephemeralKey}`,
          'Content-Type': 'application/sdp'
        },
        body: offer.sdp
      });

      if (!sdpResponse.ok) {
        const errorText = await sdpResponse.text();
        throw new Error(`Failed to connect to OpenAI Realtime: ${errorText}`);
      }

      const answerSdp = await sdpResponse.text();
      await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });

      console.log('WebRTC connection established!');

    } catch (error) {
      if (connectTimeoutRef.current) {
        window.clearTimeout(connectTimeoutRef.current);
        connectTimeoutRef.current = null;
      }
      console.error('Connection error:', error);
      optionsRef.current.onError?.(error instanceof Error ? error.message : 'Connection failed');
      updateStatus('idle');
      disconnect();
    }
  }, [updateStatus, disconnect, handleRealtimeEvent, requestResponse]);

  const sendTextMessage = useCallback((text: string) => {
    if (dcRef.current?.readyState !== 'open') {
      console.error('Data channel not open');
      return;
    }

    // Send a text message to the agent, then request the response via the single gateway.
    const event = {
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'user',
        content: [{
          type: 'input_text',
          text
        }]
      }
    };

    dcRef.current.send(JSON.stringify(event));
    requestResponse('text-message', { queueIfBusy: true });
  }, [requestResponse]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  return {
    status,
    isAgentSpeaking,
    inputReady,
    transcript,
    agentResponse,
    connect,
    disconnect,
    sendTextMessage,
    setOutputMuted: (muted: boolean) => {
      if (audioElementRef.current) audioElementRef.current.muted = muted;
    },
    isMuted,
    // Manual mic mute toggle — lets the operator step out for a side
    // conversation without ending the session. The mic stays off across
    // Aegis's turns until toggled back on. Applies immediately, except while
    // Aegis is mid-speech (the speaking auto-mute already holds it off then;
    // response end will then respect userMutedRef).
    toggleMute: () => {
      const next = !userMutedRef.current;
      userMutedRef.current = next;
      setIsMuted(next);
      // Unmuting may only re-enable the mic when the half-duplex input gate is OPEN — never
      // open the mic while Aegis owns the channel (gate closed / mid-speech).
      mediaStreamRef.current?.getAudioTracks().forEach(t => { t.enabled = !next && inputGateOpenRef.current; });
    },
    isConnected: status !== 'idle' && status !== 'connecting'
  };
}
