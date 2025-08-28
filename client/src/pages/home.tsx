import { useEffect } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Heart, Users, TrendingUp } from "lucide-react";

export default function Home() {
  const { user, isLoading } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  useEffect(() => {
    if (!isLoading && user) {
      // Redirect based on existing user type
      if (user.userType === 'client') {
        setLocation('/client');
      } else if (user.userType === 'companion') {
        setLocation('/companion');
      }
    }
  }, [user, isLoading, setLocation]);

  const handleUserTypeSelection = async (userType: 'client' | 'companion') => {
    try {
      await apiRequest('POST', '/api/setup-user-type', { userType });
      toast({
        title: "Success",
        description: `Welcome! You're all set as a ${userType}.`,
      });

      if (userType === 'client') {
        setLocation('/client');
      } else {
        setLocation('/companion');
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to setup your account. Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleLogout = () => {
    window.location.href = "/api/logout";
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <div className="bg-card/80 backdrop-blur-md border-b border-border p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 bg-gradient-to-br from-primary to-accent rounded-full flex items-center justify-center">
              <Heart className="w-5 h-5 text-primary-foreground" />
            </div>
            <h1 className="text-xl font-bold">Vannisetu</h1>
          </div>
          <Button 
            variant="ghost" 
            onClick={handleLogout}
            data-testid="button-logout"
          >
            Logout
          </Button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col justify-center items-center p-6">
        <div className="max-w-md w-full">
          <div className="text-center mb-8">
            <h2 className="text-2xl font-bold mb-2">
              Welcome, {user?.firstName || 'Friend'}!
            </h2>
            <p className="text-muted-foreground">
              Choose how you'd like to use Vannisetu
            </p>
          </div>

          <div className="space-y-4">
            <Card 
              className="cursor-pointer hover:shadow-lg transition-all duration-200 hover:scale-[1.02] border-2 hover:border-primary"
              onClick={() => handleUserTypeSelection('client')}
              data-testid="card-client-selection"
            >
              <CardContent className="p-6">
                <div className="flex items-center space-x-4">
                  <div className="w-12 h-12 bg-primary/20 rounded-full flex items-center justify-center">
                    <Users className="w-6 h-6 text-primary" />
                  </div>
                  <div className="flex-1">
                    <h3 className="font-semibold text-lg">I'm Looking for Companionship</h3>
                    <p className="text-sm text-muted-foreground">
                      Connect with verified companions for meaningful conversations
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card 
              className="cursor-pointer hover:shadow-lg transition-all duration-200 hover:scale-[1.02] border-2 hover:border-accent"
              onClick={() => handleUserTypeSelection('companion')}
              data-testid="card-companion-selection"
            >
              <CardContent className="p-6">
                <div className="flex items-center space-x-4">
                  <div className="w-12 h-12 bg-accent/20 rounded-full flex items-center justify-center">
                    <TrendingUp className="w-6 h-6 text-accent" />
                  </div>
                  <div className="flex-1">
                    <h3 className="font-semibold text-lg">I Want to Earn as Companion</h3>
                    <p className="text-sm text-muted-foreground">
                      Monetize your time and conversational skills
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="text-center mt-6">
            <p className="text-sm text-muted-foreground">
              You can change this selection later in your profile settings
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
