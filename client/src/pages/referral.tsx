import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Copy, Gift, Users, TrendingUp, Plus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

interface ReferralCode {
  id: string;
  code: string;
  bonusCoins: number;
  referrerBonus: number;
  maxUses: number;
  currentUses: number;
  isActive: boolean;
  expiresAt: string | null;
  createdAt: string;
}

export default function Referral() {
  const { toast } = useToast();
  const [newCode, setNewCode] = useState("");
  const [redeemCode, setRedeemCode] = useState("");
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);

  const { data: referralCodes = [], isLoading } = useQuery({
    queryKey: ["/api/referral/my-codes"],
  });

  const { data: affiliateProfile } = useQuery({
    queryKey: ["/api/affiliate/my-profile"],
  });

  const createCodeMutation = useMutation({
    mutationFn: async (codeData: { code: string; bonusCoins: number; referrerBonus: number; maxUses: number }) => {
      return await apiRequest("POST", "/api/referral/create-code", codeData);
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Referral code created successfully!",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/referral/my-codes"] });
      setIsCreateDialogOpen(false);
      setNewCode("");
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create referral code",
        variant: "destructive",
      });
    },
  });

  const redeemMutation = useMutation({
    mutationFn: async (code: string) => {
      return await apiRequest("POST", "/api/referral/use-code", { code });
    },
    onSuccess: (data) => {
      toast({
        title: "Success",
        description: `Referral code applied! You received ${data.coinsAwarded} coins.`,
      });
      setRedeemCode("");
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to redeem referral code",
        variant: "destructive",
      });
    },
  });

  const joinAffiliateMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("POST", "/api/affiliate/join");
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Welcome to the affiliate program!",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/affiliate/my-profile"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to join affiliate program",
        variant: "destructive",
      });
    },
  });

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({
      title: "Copied!",
      description: "Referral code copied to clipboard",
    });
  };

  const generateRandomCode = () => {
    const code = `REF_${Math.random().toString(36).substr(2, 8).toUpperCase()}`;
    setNewCode(code);
  };

  if (isLoading) {
    return (
      <div className="container mx-auto p-6 max-w-6xl">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 rounded w-1/3"></div>
          <div className="grid gap-6 md:grid-cols-2">
            {[1, 2].map((i) => (
              <div key={i} className="h-48 bg-gray-200 rounded-lg"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 max-w-6xl" data-testid="referral-page">
      <div className="text-center mb-8">
        <h1 className="text-3xl font-bold mb-2" data-testid="referral-title">
          Referral & Rewards
        </h1>
        <p className="text-muted-foreground text-lg">
          Invite friends and earn coins together
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2 mb-8">
        {/* Redeem Code Section */}
        <Card data-testid="redeem-code-section">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Gift className="w-5 h-5" />
              Redeem Code
            </CardTitle>
            <CardDescription>
              Have a referral code? Enter it here to get bonus coins
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="redeemCode">Referral Code</Label>
              <Input
                id="redeemCode"
                placeholder="Enter referral code"
                value={redeemCode}
                onChange={(e) => setRedeemCode(e.target.value)}
                data-testid="input-redeem-code"
              />
            </div>
          </CardContent>
          <CardFooter>
            <Button 
              className="w-full" 
              onClick={() => redeemMutation.mutate(redeemCode)}
              disabled={!redeemCode || redeemMutation.isPending}
              data-testid="button-redeem-code"
            >
              {redeemMutation.isPending ? 'Redeeming...' : 'Redeem Code'}
            </Button>
          </CardFooter>
        </Card>

        {/* Affiliate Program Section */}
        <Card data-testid="affiliate-section">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="w-5 h-5" />
              Affiliate Program
            </CardTitle>
            <CardDescription>
              Earn commissions by promoting Vannisetu
            </CardDescription>
          </CardHeader>
          <CardContent>
            {affiliateProfile ? (
              <div className="space-y-3">
                <div>
                  <Label>Your Affiliate Code</Label>
                  <div className="flex items-center gap-2">
                    <Input value={affiliateProfile.affiliateCode} readOnly />
                    <Button 
                      variant="outline" 
                      size="icon"
                      onClick={() => copyToClipboard(affiliateProfile.affiliateCode)}
                      data-testid="button-copy-affiliate-code"
                    >
                      <Copy className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4 text-center">
                  <div>
                    <div className="text-2xl font-bold text-green-600">
                      ₹{affiliateProfile.totalEarnings || 0}
                    </div>
                    <div className="text-sm text-muted-foreground">Total Earnings</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-blue-600">
                      {affiliateProfile.totalReferrals || 0}
                    </div>
                    <div className="text-sm text-muted-foreground">Referrals</div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-center space-y-4">
                <p className="text-muted-foreground">
                  Join our affiliate program to earn 5% commission on every referral
                </p>
                <Button 
                  onClick={() => joinAffiliateMutation.mutate()}
                  disabled={joinAffiliateMutation.isPending}
                  data-testid="button-join-affiliate"
                >
                  {joinAffiliateMutation.isPending ? 'Joining...' : 'Join Affiliate Program'}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* My Referral Codes */}
      <Card data-testid="my-referral-codes">
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Users className="w-5 h-5" />
              My Referral Codes
            </CardTitle>
            <CardDescription>
              Create and manage your referral codes
            </CardDescription>
          </div>
          
          <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
            <DialogTrigger asChild>
              <Button data-testid="button-create-code">
                <Plus className="w-4 h-4 mr-2" />
                Create Code
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create Referral Code</DialogTitle>
                <DialogDescription>
                  Create a custom referral code for your friends
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <Label htmlFor="code">Referral Code</Label>
                  <div className="flex gap-2">
                    <Input
                      id="code"
                      placeholder="Enter code"
                      value={newCode}
                      onChange={(e) => setNewCode(e.target.value)}
                      data-testid="input-new-code"
                    />
                    <Button variant="outline" onClick={generateRandomCode} data-testid="button-generate-code">
                      Generate
                    </Button>
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button 
                  onClick={() => createCodeMutation.mutate({
                    code: newCode,
                    bonusCoins: 100,
                    referrerBonus: 50,
                    maxUses: 100
                  })}
                  disabled={!newCode || createCodeMutation.isPending}
                  data-testid="button-create-referral-code"
                >
                  {createCodeMutation.isPending ? 'Creating...' : 'Create Code'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {referralCodes.length === 0 ? (
              <div className="text-center text-muted-foreground py-8">
                No referral codes yet. Create your first one!
              </div>
            ) : (
              referralCodes.map((code: ReferralCode) => (
                <div key={code.id} className="flex items-center justify-between p-4 border rounded-lg" data-testid={`referral-code-${code.code}`}>
                  <div>
                    <div className="font-mono font-semibold">{code.code}</div>
                    <div className="text-sm text-muted-foreground">
                      {code.currentUses}/{code.maxUses} uses • {code.bonusCoins} coins bonus
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={code.isActive ? "default" : "secondary"}>
                      {code.isActive ? "Active" : "Inactive"}
                    </Badge>
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={() => copyToClipboard(code.code)}
                      data-testid={`button-copy-${code.code}`}
                    >
                      <Copy className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}