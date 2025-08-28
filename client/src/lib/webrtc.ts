interface WebRTCConfig {
  iceServers: RTCIceServer[];
}

const webrtcConfig: WebRTCConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

let localPeerConnection: RTCPeerConnection | null = null;
let localStream: MediaStream | null = null;
let remoteStream: MediaStream | null = null;
let websocket: WebSocket | null = null;

export async function initializeWebRTC(
  localVideoRef: React.RefObject<HTMLVideoElement>,
  remoteVideoRef: React.RefObject<HTMLVideoElement>,
  callId: string
): Promise<void> {
  try {
    // Get user media
    localStream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30 }
      },
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });

    // Set local video
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = localStream;
    }

    // Create peer connection
    localPeerConnection = new RTCPeerConnection(webrtcConfig);

    // Add local stream to peer connection
    localStream.getTracks().forEach(track => {
      if (localPeerConnection && localStream) {
        localPeerConnection.addTrack(track, localStream);
      }
    });

    // Handle remote stream
    localPeerConnection.ontrack = (event) => {
      const [stream] = event.streams;
      remoteStream = stream;
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = stream;
      }
    };

    // Handle ICE candidates
    localPeerConnection.onicecandidate = (event) => {
      if (event.candidate && websocket) {
        websocket.send(JSON.stringify({
          type: 'ice-candidate',
          candidate: event.candidate,
          callId,
        }));
      }
    };

    // Connect to signaling server
    await connectSignalingServer(callId);

    console.log('WebRTC initialized successfully');
  } catch (error) {
    console.error('Failed to initialize WebRTC:', error);
    throw error;
  }
}

async function connectSignalingServer(callId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    
    websocket = new WebSocket(wsUrl);

    websocket.onopen = () => {
      console.log('Connected to signaling server');
      
      // Register for this call
      websocket?.send(JSON.stringify({
        type: 'register',
        callId,
      }));
      
      resolve();
    };

    websocket.onmessage = async (event) => {
      try {
        const message = JSON.parse(event.data);
        await handleSignalingMessage(message, callId);
      } catch (error) {
        console.error('Error handling signaling message:', error);
      }
    };

    websocket.onerror = (error) => {
      console.error('WebSocket error:', error);
      reject(error);
    };

    websocket.onclose = () => {
      console.log('Disconnected from signaling server');
    };
  });
}

async function handleSignalingMessage(message: any, callId: string): Promise<void> {
  if (!localPeerConnection) return;

  switch (message.type) {
    case 'call-offer':
      await localPeerConnection.setRemoteDescription(new RTCSessionDescription(message.offer));
      const answer = await localPeerConnection.createAnswer();
      await localPeerConnection.setLocalDescription(answer);
      
      websocket?.send(JSON.stringify({
        type: 'call-answer',
        answer: answer,
        callId,
      }));
      break;

    case 'call-answer':
      await localPeerConnection.setRemoteDescription(new RTCSessionDescription(message.answer));
      break;

    case 'ice-candidate':
      await localPeerConnection.addIceCandidate(new RTCIceCandidate(message.candidate));
      break;

    case 'call-end':
      cleanupWebRTC();
      break;
  }
}

export async function createOffer(callId: string): Promise<void> {
  if (!localPeerConnection || !websocket) return;

  const offer = await localPeerConnection.createOffer();
  await localPeerConnection.setLocalDescription(offer);

  websocket.send(JSON.stringify({
    type: 'call-offer',
    offer: offer,
    callId,
  }));
}

export function toggleAudio(muted: boolean): void {
  if (localStream) {
    localStream.getAudioTracks().forEach(track => {
      track.enabled = !muted;
    });
  }
}

export function toggleVideo(disabled: boolean): void {
  if (localStream) {
    localStream.getVideoTracks().forEach(track => {
      track.enabled = !disabled;
    });
  }
}

export async function switchCamera(): Promise<void> {
  if (!localStream) return;

  const videoTrack = localStream.getVideoTracks()[0];
  if (!videoTrack) return;

  // Get current constraints
  const constraints = videoTrack.getConstraints();
  const currentFacingMode = constraints.facingMode;

  // Switch between front and back camera
  const newFacingMode = currentFacingMode === 'user' ? 'environment' : 'user';

  try {
    // Stop current video track
    videoTrack.stop();

    // Get new stream with switched camera
    const newStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: newFacingMode },
      audio: false
    });

    const newVideoTrack = newStream.getVideoTracks()[0];

    // Replace track in peer connection
    if (localPeerConnection) {
      const sender = localPeerConnection.getSenders().find(s => 
        s.track && s.track.kind === 'video'
      );
      if (sender) {
        await sender.replaceTrack(newVideoTrack);
      }
    }

    // Update local stream
    localStream.removeTrack(videoTrack);
    localStream.addTrack(newVideoTrack);
  } catch (error) {
    console.error('Failed to switch camera:', error);
  }
}

export function endCall(callId: string): void {
  if (websocket) {
    websocket.send(JSON.stringify({
      type: 'call-end',
      callId,
    }));
  }
  cleanupWebRTC();
}

export function cleanupWebRTC(): void {
  // Stop all tracks
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
    localStream = null;
  }

  if (remoteStream) {
    remoteStream.getTracks().forEach(track => track.stop());
    remoteStream = null;
  }

  // Close peer connection
  if (localPeerConnection) {
    localPeerConnection.close();
    localPeerConnection = null;
  }

  // Close WebSocket
  if (websocket) {
    websocket.close();
    websocket = null;
  }

  console.log('WebRTC cleanup completed');
}

// Utility functions for device management
export async function getAvailableDevices(): Promise<MediaDeviceInfo[]> {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices;
  } catch (error) {
    console.error('Failed to get devices:', error);
    return [];
  }
}

export async function checkMediaPermissions(): Promise<{audio: boolean, video: boolean}> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
    stream.getTracks().forEach(track => track.stop());
    return { audio: true, video: true };
  } catch (error) {
    console.error('Media permissions check failed:', error);
    return { audio: false, video: false };
  }
}
