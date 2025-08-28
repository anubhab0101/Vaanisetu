import { useState, useEffect, useRef } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { initializeWebRTC, cleanupWebRTC } from "@/lib/webrtc";
import { Button } from "@/components/ui/button";
import GiftModal from "@/components/gift-modal";
import { 
  Phone, 
  PhoneOff, 
  Mic, 
  MicOff, 
  Video, 
  VideoOff, 
  Volume2, 
  VolumeX,
  RotateCw,
  Gift,
  Coins
} from "lucide-react";

export default function VideoCall() {
  const { callId } = useParams();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const [callDuration, setCallDuration] = useState(0);
  const [isConnected, setIsConnected] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [isSpeakerOn, setIsSpeakerOn] = useState(true);
  const [showGiftModal, setShowGiftModal] = useState(false);
  
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const callStartTimeRef = useRef<number>();
  const intervalRef = useRef<NodeJS.Timeout>();

  const { data: call, isLoading } = useQuery({
    queryKey: ['/api/calls', callId],
    enabled: !!callId,
  });

  const endCallMutation = useMutation({
    mutationFn: async () => {
      const durationMinutes = Math.ceil(callDuration / 60);
      return await apiRequest('PUT', `/api/calls/${callId}`, {
        status: 'completed',
        endedAt: new Date().toISOString(),
        durationMinutes,
      });
    },
    onSuccess: () => {
      toast({
        title: "Call Ended",
        description: `Call duration: ${Math.ceil(callDuration / 60)} minutes`,
      });
      queryClient.invalidateQueries({ queryKey: ['/api/auth/user'] });
      setLocation('/client');
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to end call properly",
        variant: "destructive",
      });
    },
  });

  // Initialize WebRTC on component mount
  useEffect(() => {
    if (callId && !isConnected) {
      initializeWebRTC(localVideoRef, remoteVideoRef, callId)
        .then(() => {
          setIsConnected(true);
          callStartTimeRef.current = Date.now();
          
          // Start call timer
          intervalRef.current = setInterval(() => {
            if (callStartTimeRef.current) {
              setCallDuration(Math.floor((Date.now() - callStartTimeRef.current) / 1000));
            }
          }, 1000);
        })
        .catch((error) => {
          console.error('Failed to initialize WebRTC:', error);
          toast({
            title: "Connection Failed",
            description: "Unable to establish video call connection",
            variant: "destructive",
          });
        });
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
      cleanupWebRTC();
    };
  }, [callId, isConnected, toast]);

  const handleEndCall = () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }
    cleanupWebRTC();
    endCallMutation.mutate();
  };

  const handleToggleMute = () => {
    setIsMuted(!isMuted);
    // TODO: Implement actual audio muting
  };

  const handleToggleVideo = () => {
    setIsVideoOff(!isVideoOff);
    // TODO: Implement actual video toggle
  };

  const handleToggleSpeaker = () => {
    setIsSpeakerOn(!isSpeakerOn);
    // TODO: Implement actual speaker toggle
  };

  const handleSwitchCamera = () => {
    // TODO: Implement camera switching
  };

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const calculateCost = (duration: number) => {
    if (!call) return 0;
    const minutes = duration / 60;
    const rate = parseFloat(call.ratePerMinute);
    return (rate * minutes).toFixed(2);
  };

  if (isLoading || !call) {
    return (
      <div className="fixed inset-0 bg-background z-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full mx-auto mb-4" />
          <p>Connecting...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-gradient-to-br from-purple-900 via-blue-900 to-indigo-900 z-50">
      {/* Background overlay */}
      <div className="absolute inset-0 bg-black/30" />

      {/* Call Controls Overlay */}
      <div className="relative z-10 h-full flex flex-col text-white">
        {/* Top Bar */}
        <div className="flex items-center justify-between p-4">
          <div className="flex items-center space-x-3">
            <div className="w-12 h-12 bg-gradient-to-br from-primary to-accent rounded-full flex items-center justify-center overflow-hidden">
              <span className="font-semibold text-sm">
                {call.companionName?.charAt(0) || 'C'}
              </span>
            </div>
            <div>
              <p className="font-semibold" data-testid="text-companion-name">
                {call.companionName || 'Companion'}
              </p>
              <p className="text-sm opacity-80" data-testid="text-call-status">
                {isConnected ? 'Connected' : 'Connecting...'}
              </p>
            </div>
          </div>
          
          {/* Call Timer and Cost */}
          <div className="text-right">
            <p className="font-mono text-lg" data-testid="text-call-duration">
              {formatDuration(callDuration)}
            </p>
            <p className="text-sm opacity-80 flex items-center">
              <Coins className="w-3 h-3 mr-1" />
              <span className="coin-shine bg-clip-text text-transparent" data-testid="text-call-cost">
                ₹{calculateCost(callDuration)}
              </span>
            </p>
          </div>
        </div>

        {/* Main Video Area */}
        <div className="flex-1 relative">
          {/* Remote Video */}
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            className="absolute inset-4 w-auto h-auto max-w-full max-h-full rounded-xl object-cover bg-black/50"
            data-testid="video-remote"
          />

          {/* Fallback when no remote video */}
          <div className="absolute inset-4 bg-black/50 rounded-xl glassmorphism flex items-center justify-center">
            <div className="text-center text-white">
              <div className="w-24 h-24 bg-gradient-to-br from-primary to-accent rounded-full mx-auto mb-4 flex items-center justify-center">
                <span className="text-3xl font-semibold">
                  {call.companionName?.charAt(0) || 'C'}
                </span>
              </div>
              <p className="text-lg font-semibold">{call.companionName || 'Companion'}</p>
              <p className="text-sm opacity-80">Video Connected</p>
            </div>
          </div>

          {/* Local Video (Picture-in-Picture) */}
          <video
            ref={localVideoRef}
            autoPlay
            playsInline
            muted
            className="absolute top-4 right-4 w-24 h-32 bg-black/70 rounded-lg object-cover border border-white/30"
            data-testid="video-local"
          />

          {/* Gift Sending Button */}
          <Button
            onClick={() => setShowGiftModal(true)}
            className="absolute top-4 left-4 bg-yellow-500 hover:bg-yellow-600 p-3 rounded-full shadow-lg transition-all duration-200 hover:scale-110 gift-bounce"
            size="icon"
            data-testid="button-send-gift"
          >
            <Gift className="w-5 h-5" />
          </Button>
        </div>

        {/* Bottom Controls */}
        <div className="p-6">
          <div className="flex items-center justify-center space-x-6">
            {/* Mute Button */}
            <Button
              onClick={handleToggleMute}
              className={`w-14 h-14 rounded-full transition-colors ${
                isMuted ? 'bg-red-500 hover:bg-red-600' : 'bg-black/50 hover:bg-black/70'
              }`}
              size="icon"
              data-testid="button-toggle-mute"
            >
              {isMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
            </Button>

            {/* Video Toggle */}
            <Button
              onClick={handleToggleVideo}
              className={`w-14 h-14 rounded-full transition-colors ${
                isVideoOff ? 'bg-red-500 hover:bg-red-600' : 'bg-black/50 hover:bg-black/70'
              }`}
              size="icon"
              data-testid="button-toggle-video"
            >
              {isVideoOff ? <VideoOff className="w-5 h-5" /> : <Video className="w-5 h-5" />}
            </Button>

            {/* End Call */}
            <Button
              onClick={handleEndCall}
              className="w-16 h-16 bg-red-500 hover:bg-red-600 rounded-full transition-all duration-200 hover:scale-110"
              size="icon"
              disabled={endCallMutation.isPending}
              data-testid="button-end-call"
            >
              <PhoneOff className="w-6 h-6" />
            </Button>

            {/* Speaker */}
            <Button
              onClick={handleToggleSpeaker}
              className={`w-14 h-14 rounded-full transition-colors ${
                !isSpeakerOn ? 'bg-red-500 hover:bg-red-600' : 'bg-black/50 hover:bg-black/70'
              }`}
              size="icon"
              data-testid="button-toggle-speaker"
            >
              {isSpeakerOn ? <Volume2 className="w-5 h-5" /> : <VolumeX className="w-5 h-5" />}
            </Button>

            {/* Switch Camera */}
            <Button
              onClick={handleSwitchCamera}
              className="w-14 h-14 bg-black/50 hover:bg-black/70 rounded-full transition-colors"
              size="icon"
              data-testid="button-switch-camera"
            >
              <RotateCw className="w-5 h-5" />
            </Button>
          </div>
        </div>
      </div>

      {/* Gift Modal */}
      <GiftModal
        isOpen={showGiftModal}
        onClose={() => setShowGiftModal(false)}
        recipientId={call.companionId}
        callId={callId}
      />
    </div>
  );
}
