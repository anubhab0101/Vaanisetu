import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Check, Crown, Star, Zap } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface SubscriptionPlan {
  id: string;
  name: string;
  description: string;
  priceMonthly: string;
  features: string[];
  maxCallsPerMonth: number | null;
  bonusCoinsPerMonth: number;
  isActive: boolean;
}

export default function Subscription() {
  const { toast } = useToast();
  const [selectedPlan, setSelectedPlan] = useState<string>("");

  const { data: plans = [], isLoading } = useQuery({
    queryKey: ["/api/subscription/plans"],
  });

  const { data: currentSubscription } = useQuery({
    queryKey: ["/api/subscription/current"],
  });

  const subscribeMutation = useMutation({
    mutationFn: async (planId: string) => {
      return await apiRequest("POST", "/api/subscription/subscribe", { planId });
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Subscription activated successfully!",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/subscription/current"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to activate subscription",
        variant: "destructive",
      });
    },
  });

  const cancelMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("POST", "/api/subscription/cancel");
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Subscription cancelled successfully",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/subscription/current"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to cancel subscription",
        variant: "destructive",
      });
    },
  });

  const getPlanIcon = (planName: string) => {
    switch (planName.toLowerCase()) {
      case 'basic': return <Zap className="w-6 h-6 text-blue-500" />;
      case 'premium': return <Star className="w-6 h-6 text-purple-500" />;
      case 'vip': return <Crown className="w-6 h-6 text-gold-500" />;
      default: return <Zap className="w-6 h-6 text-gray-500" />;
    }
  };

  const getPlanStyle = (planName: string) => {
    switch (planName.toLowerCase()) {
      case 'basic': return 'border-blue-200 bg-blue-50/50';
      case 'premium': return 'border-purple-200 bg-purple-50/50 ring-2 ring-purple-200';
      case 'vip': return 'border-yellow-200 bg-gradient-to-br from-yellow-50 to-orange-50 ring-2 ring-yellow-300';
      default: return 'border-gray-200';
    }
  };

  if (isLoading) {
    return (
      <div className="container mx-auto p-6 max-w-6xl">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 rounded w-1/3"></div>
          <div className="grid gap-6 md:grid-cols-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-96 bg-gray-200 rounded-lg"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 max-w-6xl" data-testid="subscription-page">
      <div className="text-center mb-8">
        <h1 className="text-3xl font-bold mb-2" data-testid="subscription-title">
          Choose Your Plan
        </h1>
        <p className="text-muted-foreground text-lg" data-testid="subscription-description">
          Unlock premium features and get more coins every month
        </p>
      </div>

      {currentSubscription && (
        <Card className="mb-8 border-green-200 bg-green-50/50" data-testid="current-subscription">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-green-800">Current Subscription</h3>
                <p className="text-green-600">{currentSubscription.plan?.name} - ₹{currentSubscription.plan?.priceMonthly}/month</p>
              </div>
              <Button 
                variant="outline" 
                onClick={() => cancelMutation.mutate()}
                disabled={cancelMutation.isPending}
                data-testid="button-cancel-subscription"
              >
                {cancelMutation.isPending ? 'Cancelling...' : 'Cancel Subscription'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 md:grid-cols-3">
        {plans.map((plan: SubscriptionPlan) => (
          <Card 
            key={plan.id} 
            className={`relative transition-all hover:shadow-lg ${getPlanStyle(plan.name)} ${
              plan.name.toLowerCase() === 'premium' ? 'scale-105' : ''
            }`}
            data-testid={`subscription-plan-${plan.name.toLowerCase()}`}
          >
            {plan.name.toLowerCase() === 'premium' && (
              <Badge className="absolute -top-3 left-1/2 -translate-x-1/2 bg-purple-500 hover:bg-purple-600">
                Most Popular
              </Badge>
            )}
            
            <CardHeader className="text-center">
              <div className="flex justify-center mb-2">
                {getPlanIcon(plan.name)}
              </div>
              <CardTitle className="text-2xl" data-testid={`plan-name-${plan.name.toLowerCase()}`}>
                {plan.name}
              </CardTitle>
              <CardDescription data-testid={`plan-description-${plan.name.toLowerCase()}`}>
                {plan.description}
              </CardDescription>
              <div className="pt-4">
                <span className="text-3xl font-bold" data-testid={`plan-price-${plan.name.toLowerCase()}`}>
                  ₹{plan.priceMonthly}
                </span>
                <span className="text-muted-foreground">/month</span>
              </div>
            </CardHeader>

            <CardContent className="space-y-4">
              <div className="space-y-3">
                {plan.features.map((feature, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <Check className="w-4 h-4 text-green-500 flex-shrink-0" />
                    <span className="text-sm">{feature}</span>
                  </div>
                ))}
                
                <div className="flex items-center gap-2 border-t pt-3">
                  <Check className="w-4 h-4 text-green-500 flex-shrink-0" />
                  <span className="text-sm font-medium">
                    {plan.bonusCoinsPerMonth} bonus coins monthly
                  </span>
                </div>
                
                {plan.maxCallsPerMonth && (
                  <div className="flex items-center gap-2">
                    <Check className="w-4 h-4 text-green-500 flex-shrink-0" />
                    <span className="text-sm">
                      Up to {plan.maxCallsPerMonth} calls per month
                    </span>
                  </div>
                )}
              </div>
            </CardContent>

            <CardFooter>
              <Button 
                className="w-full" 
                variant={plan.name.toLowerCase() === 'premium' ? 'default' : 'outline'}
                onClick={() => subscribeMutation.mutate(plan.id)}
                disabled={subscribeMutation.isPending || currentSubscription?.planId === plan.id}
                data-testid={`button-subscribe-${plan.name.toLowerCase()}`}
              >
                {subscribeMutation.isPending && selectedPlan === plan.id ? 'Processing...' : 
                 currentSubscription?.planId === plan.id ? 'Current Plan' : 
                 `Subscribe to ${plan.name}`}
              </Button>
            </CardFooter>
          </Card>
        ))}
      </div>

      <div className="mt-12 text-center">
        <h2 className="text-2xl font-bold mb-4">Why Subscribe?</h2>
        <div className="grid gap-6 md:grid-cols-3 text-center">
          <div>
            <Zap className="w-8 h-8 mx-auto mb-2 text-blue-500" />
            <h3 className="font-semibold mb-2">More Coins</h3>
            <p className="text-sm text-muted-foreground">
              Get bonus coins every month to enjoy more conversations
            </p>
          </div>
          <div>
            <Star className="w-8 h-8 mx-auto mb-2 text-purple-500" />
            <h3 className="font-semibold mb-2">Priority Access</h3>
            <p className="text-sm text-muted-foreground">
              Get matched with verified companions faster
            </p>
          </div>
          <div>
            <Crown className="w-8 h-8 mx-auto mb-2 text-yellow-500" />
            <h3 className="font-semibold mb-2">Exclusive Features</h3>
            <p className="text-sm text-muted-foreground">
              Access VIP-only companions and premium features
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}