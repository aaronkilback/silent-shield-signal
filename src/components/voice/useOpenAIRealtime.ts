import { useState, useRef, useCallback, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

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
  
  // Use ref for options to avoid stale closures in event handlers
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  const updateStatus = useCallback((newStatus: typeof status) => {
    statusRef.current = newStatus;
    setStatus(newStatus);
    optionsRef.current.onStatusChange?.(newStatus);
  }, []);

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
        body: { tool_name: toolName, arguments: toolArgs }
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
        
        // Trigger response generation
        console.log('[Voice] Triggering response generation...');
        dcRef.current.send(JSON.stringify({
          type: 'response.create'
        }));
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
        
        dcRef.current.send(JSON.stringify({
          type: 'response.create'
        }));
      }
    }
  }, [updateStatus]);

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
        // VAD detected end of speech - update status to show we're processing
        // The server will automatically create a response due to turn_detection.create_response: true
        updateStatus('thinking');
        
        // Fallback: if no response comes within 3 seconds, manually request one
        if (responseFallbackRef.current) {
          window.clearTimeout(responseFallbackRef.current);
        }
        responseFallbackRef.current = window.setTimeout(() => {
          // Use statusRef.current to get current value (not stale closure)
          if (dcRef.current?.readyState === 'open' && statusRef.current === 'thinking') {
            console.log('[Voice] Fallback: manually requesting response after speech stopped');
            dcRef.current.send(JSON.stringify({ type: 'response.create' }));
          }
        }, 3000);
        break;
      
      case 'input_audio_buffer.committed':
        console.log('Audio buffer committed to server');
        updateStatus('thinking');
        break;

      case 'conversation.item.input_audio_transcription.completed':
        {
          const transcriptText = (event as Record<string, unknown>).transcript as string;
          console.log('User transcript:', transcriptText);
          setTranscript(transcriptText);
          optionsRef.current.onTranscript?.(transcriptText, true);
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

      case 'response.audio_transcript.delta':
        {
          const delta = (event as Record<string, unknown>).delta as string;
          console.log('Agent response delta:', delta);
          setAgentResponse(prev => prev + delta);
          optionsRef.current.onAgentResponse?.(delta);
        }
        break;

      case 'response.audio_transcript.done':
        {
          // Full transcript is complete - notify with final text
          const fullTranscript = (event as Record<string, unknown>).transcript as string;
          console.log('Agent finished speaking, full transcript:', fullTranscript);
          // Call a new callback for the complete response
          optionsRef.current.onAgentResponseComplete?.(fullTranscript || '');
        }
        break;

      case 'response.audio.delta':
        // Audio is handled by WebRTC track, but this indicates agent is speaking
        // Clear fallback timer since we're getting a response
        if (responseFallbackRef.current) {
          window.clearTimeout(responseFallbackRef.current);
          responseFallbackRef.current = null;
        }
        setIsAgentSpeaking(true);
        updateStatus('speaking');
        break;

      case 'response.audio.done':
        setIsAgentSpeaking(false);
        updateStatus('connected');
        break;

      case 'response.done':
        setIsAgentSpeaking(false);
        updateStatus('connected');
        // Reset internal agent response for next turn
        setAgentResponse('');
        break;

      case 'error':
        {
          const errorData = (event as Record<string, unknown>).error as Record<string, unknown>;
          console.error('Realtime error:', errorData);
          optionsRef.current.onError?.(errorData?.message as string || 'Unknown error');
        }
        break;

      default:
        // Log unhandled events for debugging
        if (event.type && !(event.type as string).startsWith('rate_limits')) {
          console.log('Unhandled event type:', event.type);
        }
    }
  }, [updateStatus, executeToolCall]);

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
          dc.send(JSON.stringify({
            type: 'response.create',
            response: {
              modalities: ['audio', 'text'],
              instructions:
                'Greet the user briefly. Say something like "Aegis here. How can I help?" Keep it under 10 words.',
            },
          }));
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
      const sdpResponse = await fetch('https://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-12-17', {
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
  }, [updateStatus, disconnect, handleRealtimeEvent]);

  const sendTextMessage = useCallback((text: string) => {
    if (dcRef.current?.readyState !== 'open') {
      console.error('Data channel not open');
      return;
    }

    // Send a text message to the agent
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
    dcRef.current.send(JSON.stringify({ type: 'response.create' }));
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  return {
    status,
    isAgentSpeaking,
    transcript,
    agentResponse,
    connect,
    disconnect,
    sendTextMessage,
    setOutputMuted: (muted: boolean) => {
      if (audioElementRef.current) audioElementRef.current.muted = muted;
    },
    isConnected: status !== 'idle' && status !== 'connecting'
  };
}
