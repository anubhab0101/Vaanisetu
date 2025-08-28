import { useState } from "react";
import { useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Star, CheckCircle, Video, Eye } from "lucide-react";

interface CompanionCardProps {
  companion: {
    id: string;
    displayName: string;
    bio?: string;
    age?: number;
    city?: string;
    languages?: string[];
    interests?: string[];
    ratePerMinute: string;
    averageRating: string;
    totalReviews: number;
    availabilityStatus: string;
    verificationStatus: string;
    profilePhotos?: string[];
  };
  userCoinBalance: number;
}

export default function CompanionCard({ companion, userCoinBalance }: CompanionCardProps) {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [isInitiatingCall, setIsInitiatingCall] = useState(false);

  const createCallMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest('POST', '/api/calls', {
        companionId: companion.id,
        ratePerMinute: companion.ratePerMinute,
        status: 'pending',
      });
    },
    onSuccess: (response) => {
      const callData = response.json();
      setLocation(`/call/${callData.id}`);
    },
    onError: (error: Error) => {
      toast({
        title: "Call Failed",
        description: error.message.includes('Insufficient') 
          ? "You don't have enough coins. Please add coins to your wallet."
          : "Failed to initiate call. Please try again.",
        variant: "destructive",
      });
      setIsInitiatingCall(false);
    },
  });

  const handleInitiateCall = () => {
    if (companion.availabilityStatus !== 'online') {
      toast({
        title: "Companion Unavailable",
        description: "This companion is currently offline.",
        variant: "destructive",
      });
      return;
    }

    const estimatedCost = Math.ceil(parseFloat(companion.ratePerMinute) * 10 / 0.15); // 10 minutes estimate
    if (userCoinBalance < estimatedCost) {
      toast({
        title: "Insufficient Coins",
        description: "You need more coins to make this call.",
        variant: "destructive",
      });
      return;
    }

    setIsInitiatingCall(true);
    createCallMutation.mutate();
  };

  const handleViewProfile = () => {
    // TODO: Implement profile modal or page
    toast({
      title: "Coming Soon",
      description: "Detailed profile view will be available soon.",
    });
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'online': return 'bg-green-500';
      case 'busy': return 'bg-yellow-500';
      default: return 'bg-gray-500';
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'online': return 'Online';
      case 'busy': return 'Busy';
      default: return 'Offline';
    }
  };

  return (
    <Card className="overflow-hidden border border-border hover:shadow-xl transition-all duration-300 hover:scale-[1.02]">
      {/* Profile Image with Status */}
      <div className="relative">
        <div className="w-full h-48 bg-muted flex items-center justify-center overflow-hidden">
          <Avatar className="w-full h-full rounded-none">
            <AvatarImage 
              src={companion.profilePhotos?.[0]} 
              alt={companion.displayName}
              className="object-cover"
            />
            <AvatarFallback className="w-full h-full text-4xl rounded-none">
              {companion.displayName.charAt(0)}
            </AvatarFallback>
          </Avatar>
        </div>
        
        {/* Online Status */}
        <div className={`absolute top-3 left-3 ${getStatusColor(companion.availabilityStatus)} text-white px-2 py-1 rounded-full text-xs font-medium flex items-center space-x-1`}>
          <div className="w-2 h-2 bg-white rounded-full animate-pulse-slow"></div>
          <span>{getStatusText(companion.availabilityStatus)}</span>
        </div>

        {/* Verification Badge */}
        {companion.verificationStatus === 'verified' && (
          <div className="absolute top-3 right-3 bg-blue-500 text-white p-1 rounded-full">
            <CheckCircle className="w-3 h-3" />
          </div>
        )}
      </div>

      {/* Profile Info */}
      <CardContent className="p-4">
        <div className="flex items-start justify-between mb-2">
          <div className="flex-1">
            <h3 className="font-semibold text-lg" data-testid={`text-companion-name-${companion.id}`}>
              {companion.displayName}
            </h3>
            <p className="text-sm text-muted-foreground">
              {companion.age && `${companion.age} • `}{companion.city}
            </p>
          </div>
          <div className="text-right">
            <div className="flex items-center space-x-1 text-yellow-500 mb-1">
              <Star className="w-4 h-4 fill-current" />
              <span className="text-sm font-medium">
                {parseFloat(companion.averageRating).toFixed(1)}
              </span>
              <span className="text-xs text-muted-foreground">
                ({companion.totalReviews})
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              <span className="coin-shine bg-clip-text text-transparent font-medium">
                ₹{companion.ratePerMinute}/min
              </span>
            </p>
          </div>
        </div>

        {/* Bio Preview */}
        {companion.bio && (
          <p className="text-sm text-muted-foreground mb-3 line-clamp-2">
            {companion.bio}
          </p>
        )}

        {/* Languages and Interests */}
        <div className="flex flex-wrap gap-1 mb-3">
          {companion.languages?.slice(0, 2).map((language) => (
            <Badge key={language} variant="secondary" className="text-xs">
              {language}
            </Badge>
          ))}
          {companion.interests?.slice(0, 2).map((interest) => (
            <Badge key={interest} variant="outline" className="text-xs">
              {interest}
            </Badge>
          ))}
        </div>

        {/* Action Buttons */}
        <div className="flex space-x-2">
          <Button
            variant="outline"
            className="flex-1"
            onClick={handleViewProfile}
            data-testid={`button-view-profile-${companion.id}`}
          >
            <Eye className="w-4 h-4 mr-2" />
            View Profile
          </Button>
          <Button
            className="flex-1"
            onClick={handleInitiateCall}
            disabled={isInitiatingCall || companion.availabilityStatus !== 'online'}
            data-testid={`button-call-${companion.id}`}
          >
            {isInitiatingCall ? (
              <>
                <div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full mr-2" />
                Calling...
              </>
            ) : (
              <>
                <Video className="w-4 h-4 mr-2" />
                {companion.availabilityStatus === 'online' ? 'Call Now' : 'Offline'}
              </>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
