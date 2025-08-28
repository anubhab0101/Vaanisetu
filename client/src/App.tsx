import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuth } from "@/hooks/useAuth";
import Landing from "@/pages/landing";
import Home from "@/pages/home";
import ClientDashboard from "@/pages/client-dashboard";
import CompanionDashboard from "@/pages/companion-dashboard";
import VideoCall from "@/pages/video-call";
import Checkout from "@/pages/checkout";
import Subscription from "@/pages/subscription";
import Referral from "@/pages/referral";
import NotFound from "@/pages/not-found";

function Router() {
  const { isAuthenticated, isLoading } = useAuth();

  return (
    <Switch>
      {isLoading || !isAuthenticated ? (
        <Route path="/" component={Landing} />
      ) : (
        <>
          <Route path="/" component={Home} />
          <Route path="/client" component={ClientDashboard} />
          <Route path="/companion" component={CompanionDashboard} />
          <Route path="/call/:callId" component={VideoCall} />
          <Route path="/checkout" component={Checkout} />
          <Route path="/subscription" component={Subscription} />
          <Route path="/referral" component={Referral} />
        </>
      )}
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5">
          <Toaster />
          <Router />
        </div>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
