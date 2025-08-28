import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { 
  Gift,
  X,
  Coins
} from "lucide-react";

interface GiftModalProps {
  isOpen: boolean;
  onClose: () => void;
  recipientId: string;
  callId?: string;
}

interface GiftItem {
  id: string;
  name: string;
  emoji: string;
  coinCost: number;
  category: string;
}

const giftCategories = [
  { id: 'popular', label: 'Popular', active: true },
  { id: 'flowers', label: 'Flowers' },
  { id: 'luxury', label: 'Luxury' },
  { id: 'fun', label: 'Fun' },
];

// Default gifts (fallback if API fails)
const defaultGifts: GiftItem[] = [
  { id: '1', name: 'Rose', emoji: '🌹', coinCost: 50, category: 'flowers' },
  { id: '2', name: 'Heart', emoji: '💖', coinCost: 25, category: 'popular' },
  { id: '3', name: 'Diamond', emoji: '💎', coinCost: 500, category: 'luxury' },
  { id: '4', name: 'Bouquet', emoji: '💐', coinCost: 100, category: 'flowers' },
  { id: '5', name: 'Cake', emoji: '🎂', coinCost: 75, category: 'fun' },
  { id: '6', name: 'Crown', emoji: '👑', coinCost: 1000, category: 'luxury' },
];

export default function GiftModal({ isOpen, onClose, recipientId, callId }: GiftModalProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedCategory, setSelectedCategory] = useState('popular');
  const [selectedGift, setSelectedGift] = useState<GiftItem | null>(null);

  const { data: gifts = defaultGifts, isLoading } = useQuery({
    queryKey: ['/api/gifts'],
    enabled: isOpen,
  });

  const sendGiftMutation = useMutation({
    mutationFn: async (gift: GiftItem) => {
      return await apiRequest('POST', '/api/gifts/send', {
        receiverId: recipientId,
        giftId: gift.id,
        callId,
      });
    },
    onSuccess: () => {
      toast({
        title: "Gift Sent! 🎁",
        description: `You sent a ${selectedGift?.emoji} ${selectedGift?.name}`,
      });
      queryClient.invalidateQueries({ queryKey: ['/api/auth/user'] });
      setSelectedGift(null);
      onClose();
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to Send Gift",
        description: error.message.includes('Insufficient') 
          ? "You don't have enough coins for this gift."
          : "Failed to send gift. Please try again.",
        variant: "destructive",
      });
    },
  });

  const filteredGifts = gifts.filter((gift: GiftItem) => 
    selectedCategory === 'popular' || gift.category === selectedCategory
  );

  const handleGiftSelect = (gift: GiftItem) => {
    setSelectedGift(gift);
  };

  const handleSendGift = () => {
    if (!selectedGift) return;

    if (!user || user.coinBalance < selectedGift.coinCost) {
      toast({
        title: "Insufficient Coins",
        description: "You need more coins to send this gift.",
        variant: "destructive",
      });
      return;
    }

    sendGiftMutation.mutate(selectedGift);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <Gift className="w-5 h-5" />
              Send a Gift
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              data-testid="button-close-gift-modal"
            >
              <X className="w-4 h-4" />
            </Button>
          </DialogTitle>
        </DialogHeader>

        {/* Gift Categories */}
        <div className="border-b border-border pb-4">
          <div className="flex space-x-2 overflow-x-auto">
            {giftCategories.map((category) => (
              <Badge
                key={category.id}
                variant={selectedCategory === category.id ? "default" : "secondary"}
                className="cursor-pointer whitespace-nowrap hover:opacity-80 transition-opacity"
                onClick={() => setSelectedCategory(category.id)}
                data-testid={`category-${category.id}`}
              >
                {category.label}
              </Badge>
            ))}
          </div>
        </div>

        {/* Gift Grid */}
        <div>
          {isLoading ? (
            <div className="grid grid-cols-3 gap-3">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="bg-muted rounded-xl h-20 animate-pulse" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-3">
              {filteredGifts.map((gift: GiftItem) => (
                <Card
                  key={gift.id}
                  className={`cursor-pointer transition-all duration-200 hover:scale-105 ${
                    selectedGift?.id === gift.id 
                      ? 'border-2 border-primary bg-primary/10' 
                      : 'border border-border hover:border-primary/50'
                  }`}
                  onClick={() => handleGiftSelect(gift)}
                  data-testid={`gift-${gift.id}`}
                >
                  <CardContent className="p-4 text-center">
                    <div className="text-3xl mb-2">{gift.emoji}</div>
                    <p className="font-medium text-sm">{gift.name}</p>
                    <div className="flex items-center justify-center space-x-1 mt-1">
                      <Coins className="w-3 h-3 text-yellow-500" />
                      <span className="text-xs text-muted-foreground">
                        {gift.coinCost}
                      </span>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {filteredGifts.length === 0 && !isLoading && (
            <div className="text-center py-8">
              <p className="text-muted-foreground">No gifts available in this category</p>
            </div>
          )}
        </div>

        {/* Send Button */}
        <div className="pt-4 border-t border-border">
          <div className="flex items-center justify-between mb-4">
            <p className="text-muted-foreground">Your Balance:</p>
            <div className="flex items-center space-x-1">
              <Coins className="w-4 h-4 text-yellow-500" />
              <span className="font-medium coin-shine bg-clip-text text-transparent">
                {user?.coinBalance || 0} coins
              </span>
            </div>
          </div>

          {selectedGift && (
            <Card className="mb-4 border-primary/50">
              <CardContent className="p-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <span className="text-2xl">{selectedGift.emoji}</span>
                    <div>
                      <p className="font-medium">{selectedGift.name}</p>
                      <div className="flex items-center space-x-1">
                        <Coins className="w-3 h-3 text-yellow-500" />
                        <span className="text-sm text-muted-foreground">
                          {selectedGift.coinCost} coins
                        </span>
                      </div>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelectedGift(null)}
                  >
                    <X className="w-4 h-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          <Button
            className="w-full h-12"
            onClick={handleSendGift}
            disabled={!selectedGift || sendGiftMutation.isPending}
            data-testid="button-send-gift"
          >
            {sendGiftMutation.isPending ? (
              <>
                <div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full mr-2" />
                Sending...
              </>
            ) : (
              <>
                <Gift className="w-4 h-4 mr-2" />
                {selectedGift ? `Send ${selectedGift.name}` : 'Select a Gift'}
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
