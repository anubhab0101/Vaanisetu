import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import ProfileVerification from "@/components/profile-verification";
import { 
  ArrowLeft, 
  Home, 
  BarChart3, 
  User, 
  Settings,
  IndianRupee,
  Clock,
  Star,
  Users,
  Edit3,
  Tag,
  TrendingUp,
  Calendar,
  Phone,
  Gift,
  Download
} from "lucide-react";

export default function CompanionDashboard() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isAvailable, setIsAvailable] = useState(true);

  const { data: analytics, isLoading } = useQuery({
    queryKey: ['/api/companion/analytics'],
    enabled: !!user?.userType && user.userType === 'companion',
  });

  const { data: companionProfile } = useQuery({
    queryKey: ['/api/auth/user'],
  });

  const toggleAvailabilityMutation = useMutation({
    mutationFn: async (available: boolean) => {
      const companion = companionProfile?.companionProfile;
      if (!companion) throw new Error("No companion profile found");
      
      return await apiRequest('PUT', `/api/companions/${companion.id}`, {
        availabilityStatus: available ? 'online' : 'offline'
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/auth/user'] });
      toast({
        title: "Status Updated",
        description: `You are now ${isAvailable ? 'online' : 'offline'}`,
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to update availability status",
        variant: "destructive",
      });
    },
  });

  const handleToggleAvailability = (checked: boolean) => {
    setIsAvailable(checked);
    toggleAvailabilityMutation.mutate(checked);
  };

  const handleLogout = () => {
    window.location.href = "/api/logout";
  };

  const recentActivities = [
    {
      type: "15-minute call completed",
      details: "With Raj • Earned ₹180",
      amount: "+₹180",
      time: "2 hours ago",
      icon: Phone,
      color: "text-green-500",
    },
    {
      type: "Gift received",
      details: "Virtual Rose from Priya",
      amount: "+₹50",
      time: "4 hours ago",
      icon: Gift,
      color: "text-yellow-500",
    },
  ];

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  // Show verification component if companion profile doesn't exist
  if (!companionProfile?.companionProfile) {
    return <ProfileVerification />;
  }

  return (
    <div className="min-h-screen">
      {/* Top Navigation */}
      <div className="bg-card/80 backdrop-blur-md border-b border-border sticky top-0 z-50">
        <div className="flex items-center justify-between p-4">
          <div className="flex items-center space-x-3">
            <Button 
              variant="ghost" 
              size="icon" 
              onClick={handleLogout}
              data-testid="button-back"
            >
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <h1 className="text-xl font-bold">Dashboard</h1>
          </div>
          <div className="flex items-center space-x-3">
            {/* Availability Toggle */}
            <div className="flex items-center space-x-2">
              <span className="text-sm text-muted-foreground">Available</span>
              <Switch
                checked={isAvailable}
                onCheckedChange={handleToggleAvailability}
                data-testid="switch-availability"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Stats Overview */}
      <div className="p-4">
        <div className="grid grid-cols-2 gap-4 mb-6">
          <Card className="bg-gradient-to-br from-green-500 to-emerald-600 text-white border-0">
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-2">
                <IndianRupee className="w-6 h-6 opacity-80" />
                <Badge className="bg-white/20 text-white border-0 text-xs">Today</Badge>
              </div>
              <p className="text-2xl font-bold" data-testid="text-today-earnings">
                ₹{analytics?.todayEarnings?.toFixed(0) || '0'}
              </p>
              <p className="text-sm opacity-90">Today's Earnings</p>
            </CardContent>
          </Card>
          
          <Card className="bg-gradient-to-br from-blue-500 to-indigo-600 text-white border-0">
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-2">
                <Clock className="w-6 h-6 opacity-80" />
                <Badge className="bg-white/20 text-white border-0 text-xs">This Week</Badge>
              </div>
              <p className="text-2xl font-bold" data-testid="text-weekly-minutes">
                {analytics?.totalMinutes || '0'}
              </p>
              <p className="text-sm opacity-90">Minutes Called</p>
            </CardContent>
          </Card>
          
          <Card className="bg-gradient-to-br from-purple-500 to-pink-600 text-white border-0">
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-2">
                <Star className="w-6 h-6 opacity-80" />
                <Badge className="bg-white/20 text-white border-0 text-xs">Rating</Badge>
              </div>
              <p className="text-2xl font-bold" data-testid="text-rating">
                {analytics?.averageRating || '0'}
              </p>
              <p className="text-sm opacity-90">Average Rating</p>
            </CardContent>
          </Card>
          
          <Card className="bg-gradient-to-br from-orange-500 to-red-600 text-white border-0">
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-2">
                <Users className="w-6 h-6 opacity-80" />
                <Badge className="bg-white/20 text-white border-0 text-xs">Total</Badge>
              </div>
              <p className="text-2xl font-bold" data-testid="text-total-reviews">
                {analytics?.totalReviews || '0'}
              </p>
              <p className="text-sm opacity-90">Happy Clients</p>
            </CardContent>
          </Card>
        </div>

        {/* Quick Actions */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-lg">Quick Actions</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3">
              <Button 
                className="justify-start h-12"
                data-testid="button-edit-profile"
              >
                <Edit3 className="w-4 h-4 mr-2" />
                Edit Profile
              </Button>
              <Button 
                variant="secondary" 
                className="justify-start h-12"
                data-testid="button-set-rate"
              >
                <Tag className="w-4 h-4 mr-2" />
                Set Rate
              </Button>
              <Button 
                variant="secondary" 
                className="justify-start h-12"
                data-testid="button-view-analytics"
              >
                <TrendingUp className="w-4 h-4 mr-2" />
                View Analytics
              </Button>
              <Button 
                variant="outline" 
                className="justify-start h-12"
                data-testid="button-manage-schedule"
              >
                <Calendar className="w-4 h-4 mr-2" />
                Schedule
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Recent Activity */}
        <Card className="mb-6">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg">Recent Activity</CardTitle>
              <Button variant="ghost" size="sm" className="text-primary">
                View All
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {recentActivities.map((activity, index) => (
                <div key={index} className="flex items-center space-x-3 p-3 bg-muted/50 rounded-lg">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center bg-${activity.color.split('-')[1]}-500/20`}>
                    <activity.icon className={`w-4 h-4 ${activity.color}`} />
                  </div>
                  <div className="flex-1">
                    <p className="font-medium text-sm">{activity.type}</p>
                    <p className="text-xs text-muted-foreground">{activity.details}</p>
                  </div>
                  <div className="text-right">
                    <p className={`text-sm font-medium ${activity.color}`}>{activity.amount}</p>
                    <p className="text-xs text-muted-foreground">{activity.time}</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Pending Withdrawals */}
        <Card className="mb-24">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg">Earnings & Withdrawal</CardTitle>
              <div className="text-right">
                <p className="text-2xl font-bold text-green-500" data-testid="text-withdrawable-balance">
                  ₹{parseFloat(analytics?.withdrawableBalance || '0').toFixed(0)}
                </p>
                <p className="text-sm text-muted-foreground">Available to withdraw</p>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <Button 
              className="w-full bg-green-500 hover:bg-green-600 h-12"
              data-testid="button-withdraw"
            >
              <Download className="w-4 h-4 mr-2" />
              Withdraw to Bank Account
            </Button>
            <p className="text-xs text-muted-foreground text-center mt-2">
              Withdrawals processed within 24 hours
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Bottom Navigation */}
      <div className="fixed bottom-0 left-0 right-0 bg-card/80 backdrop-blur-md border-t border-border">
        <div className="flex items-center justify-around py-3">
          <button className="flex flex-col items-center space-y-1 text-primary" data-testid="nav-dashboard">
            <Home className="w-5 h-5" />
            <span className="text-xs">Dashboard</span>
          </button>
          <button className="flex flex-col items-center space-y-1 text-muted-foreground hover:text-foreground" data-testid="nav-earnings">
            <BarChart3 className="w-5 h-5" />
            <span className="text-xs">Earnings</span>
          </button>
          <button className="flex flex-col items-center space-y-1 text-muted-foreground hover:text-foreground" data-testid="nav-profile">
            <User className="w-5 h-5" />
            <span className="text-xs">Profile</span>
          </button>
          <button className="flex flex-col items-center space-y-1 text-muted-foreground hover:text-foreground" data-testid="nav-settings">
            <Settings className="w-5 h-5" />
            <span className="text-xs">Settings</span>
          </button>
        </div>
      </div>
    </div>
  );
}
