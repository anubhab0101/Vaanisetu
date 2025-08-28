import { useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
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
  Coins, 
  CreditCard, 
  Smartphone, 
  Building2,
  Crown,
  ChevronRight,
  History,
  X
} from "lucide-react";

interface WalletModalProps {
  isOpen: boolean;
  onClose: () => void;
  userCoinBalance: number;
}

interface CoinPackage {
  id: string;
  coins: number;
  bonus: number;
  price: number;
  savings: number;
  popular?: boolean;
}

const coinPackages: CoinPackage[] = [
  {
    id: 'small',
    coins: 500,
    bonus: 50,
    price: 75,
    savings: 10,
  },
  {
    id: 'medium',
    coins: 1000,
    bonus: 150,
    price: 140,
    savings: 15,
  },
  {
    id: 'large',
    coins: 2500,
    bonus: 500,
    price: 330,
    savings: 20,
    popular: true,
  },
];

const paymentMethods = [
  {
    id: 'card',
    name: 'Credit/Debit Card',
    icon: CreditCard,
    color: 'text-blue-600',
  },
  {
    id: 'upi',
    name: 'UPI / Google Pay',
    icon: Smartphone,
    color: 'text-green-600',
  },
  {
    id: 'netbanking',
    name: 'Net Banking',
    icon: Building2,
    color: 'text-purple-600',
  },
];

export default function WalletModal({ isOpen, onClose, userCoinBalance }: WalletModalProps) {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedPackage, setSelectedPackage] = useState<string | null>(null);

  const { data: transactions = [] } = useQuery({
    queryKey: ['/api/transactions'],
    enabled: isOpen,
  });

  const purchaseCoinsMutation = useMutation({
    mutationFn: async (packageId: string) => {
      const response = await apiRequest('POST', '/api/create-payment-intent', {
        coinPackage: packageId,
      });
      return response.json();
    },
    onSuccess: (data) => {
      // Redirect to checkout with payment intent
      setLocation(`/checkout?package=${selectedPackage}`);
      onClose();
    },
    onError: (error) => {
      toast({
        title: "Purchase Failed",
        description: "Failed to initiate coin purchase. Please try again.",
        variant: "destructive",
      });
    },
  });

  const handlePackageSelect = (packageId: string) => {
    setSelectedPackage(packageId);
    purchaseCoinsMutation.mutate(packageId);
  };

  const handleShowTransactionHistory = () => {
    toast({
      title: "Coming Soon",
      description: "Transaction history will be available soon.",
    });
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between">
            Wallet
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              data-testid="button-close-wallet"
            >
              <X className="w-4 h-4" />
            </Button>
          </DialogTitle>
        </DialogHeader>

        {/* Current Balance */}
        <div className="border-b border-border pb-4">
          <Card className="bg-gradient-to-r from-yellow-400 to-orange-500 text-white border-0 coin-shine">
            <CardContent className="p-4 text-center">
              <div className="flex items-center justify-center space-x-2 mb-2">
                <Coins className="w-6 h-6" />
                <span className="text-3xl font-bold" data-testid="text-current-balance">
                  {userCoinBalance}
                </span>
              </div>
              <p className="text-sm opacity-90">Current Balance</p>
              <p className="text-xs opacity-80 mt-1">
                ≈ ₹{(userCoinBalance * 0.15).toFixed(2)} (@ ₹0.15 per coin)
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Coin Packages */}
        <div>
          <h3 className="font-semibold mb-4">Buy Coins</h3>
          <div className="space-y-3">
            {coinPackages.map((pkg) => (
              <Card
                key={pkg.id}
                className={`cursor-pointer transition-all duration-200 hover:scale-[1.02] ${
                  pkg.popular 
                    ? 'border-2 border-primary bg-primary/5' 
                    : 'border border-border hover:border-primary'
                }`}
                onClick={() => handlePackageSelect(pkg.id)}
                data-testid={`package-${pkg.id}`}
              >
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-3">
                      <div className="w-12 h-12 bg-gradient-to-r from-yellow-400 to-orange-500 rounded-full flex items-center justify-center coin-shine">
                        {pkg.popular ? (
                          <Crown className="w-5 h-5 text-white" />
                        ) : (
                          <Coins className="w-5 h-5 text-white" />
                        )}
                      </div>
                      <div>
                        <p className="font-medium">
                          {pkg.coins} Coins
                        </p>
                        <p className={`text-sm ${pkg.popular ? 'text-primary font-medium' : 'text-muted-foreground'}`}>
                          {pkg.popular ? `+${pkg.bonus} Bonus Coins • Popular` : `+${pkg.bonus} Bonus Coins`}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="font-bold text-lg">₹{pkg.price}</p>
                      <p className="text-xs text-green-500">Save {pkg.savings}%</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Payment Methods */}
          <div className="mt-6">
            <h4 className="font-medium mb-3">Payment Methods</h4>
            <div className="space-y-2">
              {paymentMethods.map((method) => (
                <Button
                  key={method.id}
                  variant="outline"
                  className="w-full justify-between h-12"
                  data-testid={`payment-method-${method.id}`}
                >
                  <div className="flex items-center space-x-3">
                    <method.icon className={`w-5 h-5 ${method.color}`} />
                    <span>{method.name}</span>
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground" />
                </Button>
              ))}
            </div>
          </div>

          {/* Transaction History Link */}
          <div className="mt-6 pt-4 border-t border-border">
            <Button
              variant="ghost"
              className="w-full text-primary"
              onClick={handleShowTransactionHistory}
              data-testid="button-transaction-history"
            >
              <History className="w-4 h-4 mr-2" />
              View Transaction History
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
