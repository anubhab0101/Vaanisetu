import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Heart, Shield, Video, Coins } from "lucide-react";

export default function Landing() {
  const handleLogin = () => {
    window.location.href = "/api/login";
  };

  return (
    <div className="min-h-screen flex flex-col">
      {/* Hero Section */}
      <div className="flex-1 flex flex-col justify-center items-center p-6 text-center">
        {/* App Logo and Branding */}
        <div className="mb-8">
          <div className="w-24 h-24 bg-gradient-to-br from-primary to-accent rounded-3xl flex items-center justify-center mb-4 mx-auto shadow-2xl">
            <Heart className="w-8 h-8 text-primary-foreground" />
          </div>
          <h1 className="text-4xl font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent mb-2">
            Vannisetu
          </h1>
          <p className="text-muted-foreground text-lg">
            सच्चे रिश्ते, सुरक्षित माहौल
          </p>
        </div>

        {/* Value Proposition */}
        <div className="space-y-4 max-w-sm mb-8">
          <div className="flex items-center space-x-3 text-left">
            <div className="w-10 h-10 bg-primary/20 rounded-full flex items-center justify-center">
              <Shield className="w-5 h-5 text-primary" />
            </div>
            <div>
              <p className="font-medium">Verified Companions</p>
              <p className="text-sm text-muted-foreground">Government ID verified profiles</p>
            </div>
          </div>
          <div className="flex items-center space-x-3 text-left">
            <div className="w-10 h-10 bg-accent/20 rounded-full flex items-center justify-center">
              <Video className="w-5 h-5 text-accent" />
            </div>
            <div>
              <p className="font-medium">HD Video Calls</p>
              <p className="text-sm text-muted-foreground">Crystal clear communication</p>
            </div>
          </div>
          <div className="flex items-center space-x-3 text-left">
            <div className="w-10 h-10 bg-yellow-500/20 rounded-full flex items-center justify-center">
              <Coins className="w-5 h-5 text-yellow-500" />
            </div>
            <div>
              <p className="font-medium">Transparent Pricing</p>
              <p className="text-sm text-muted-foreground">Pay only for time used</p>
            </div>
          </div>
        </div>

        {/* Login Button */}
        <Button 
          onClick={handleLogin}
          className="w-full max-w-sm bg-primary hover:bg-primary/90 text-primary-foreground py-4 px-6 rounded-xl font-medium shadow-lg transition-all duration-200 hover:shadow-xl hover:scale-[1.02]"
          data-testid="button-login"
        >
          Get Started
        </Button>

        <div className="text-center pt-4">
          <p className="text-sm text-muted-foreground">
            By continuing, you agree to our{" "}
            <a href="#" className="text-primary hover:underline">Terms</a> and{" "}
            <a href="#" className="text-primary hover:underline">Privacy Policy</a>
          </p>
        </div>
      </div>
    </div>
  );
}
