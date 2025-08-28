import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import CompanionCard from "@/components/companion-card";
import WalletModal from "@/components/wallet-modal";
import { ArrowLeft, Plus, Search, Filter, Home, History, Wallet, User, Coins } from "lucide-react";

export default function ClientDashboard() {
  const { user } = useAuth();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedFilters, setSelectedFilters] = useState<string[]>(['all']);
  const [showWalletModal, setShowWalletModal] = useState(false);

  const { data: companions = [], isLoading } = useQuery({
    queryKey: ['/api/companions'],
  });

  const filteredCompanions = companions.filter((companion: any) => {
    if (searchQuery) {
      return companion.displayName.toLowerCase().includes(searchQuery.toLowerCase()) ||
             companion.bio?.toLowerCase().includes(searchQuery.toLowerCase());
    }
    return true;
  });

  const filterButtons = [
    { id: 'all', label: 'All Online', active: true },
    { id: 'hindi', label: 'Hindi' },
    { id: 'english', label: 'English' },
    { id: 'top-rated', label: 'Top Rated' },
    { id: 'new', label: 'New' },
  ];

  const handleLogout = () => {
    window.location.href = "/api/logout";
  };

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
            <h1 className="text-xl font-bold">Discover</h1>
          </div>
          <div className="flex items-center space-x-3">
            {/* Coin Balance */}
            <div className="bg-gradient-to-r from-yellow-400 to-orange-500 text-white px-3 py-1 rounded-full flex items-center space-x-1 coin-shine">
              <Coins className="w-4 h-4" />
              <span className="font-medium text-sm" data-testid="text-coin-balance">
                {user?.coinBalance || 0}
              </span>
            </div>
            <Button 
              variant="ghost" 
              size="icon" 
              onClick={() => setShowWalletModal(true)}
              data-testid="button-add-coins"
            >
              <Plus className="w-5 h-5" />
            </Button>
          </div>
        </div>
      </div>

      {/* Search Bar */}
      <div className="p-4 bg-card/50 border-b border-border">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
          <Input
            placeholder="Search companions..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
            data-testid="input-search"
          />
        </div>
      </div>

      {/* Filter Bar */}
      <div className="p-4 bg-card/50 border-b border-border">
        <div className="flex space-x-2 overflow-x-auto pb-2">
          {filterButtons.map((filter) => (
            <Badge
              key={filter.id}
              variant={selectedFilters.includes(filter.id) ? "default" : "secondary"}
              className="cursor-pointer whitespace-nowrap hover:opacity-80 transition-opacity"
              onClick={() => {
                if (filter.id === 'all') {
                  setSelectedFilters(['all']);
                } else {
                  setSelectedFilters(prev => 
                    prev.includes(filter.id)
                      ? prev.filter(f => f !== filter.id)
                      : [...prev.filter(f => f !== 'all'), filter.id]
                  );
                }
              }}
              data-testid={`filter-${filter.id}`}
            >
              {filter.label}
            </Badge>
          ))}
        </div>
      </div>

      {/* Companions Grid */}
      <div className="p-4 pb-24">
        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="bg-card rounded-xl h-80 animate-pulse" />
            ))}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {filteredCompanions.map((companion: any) => (
                <CompanionCard 
                  key={companion.id} 
                  companion={companion}
                  userCoinBalance={user?.coinBalance || 0}
                />
              ))}
            </div>

            {filteredCompanions.length === 0 && (
              <div className="text-center py-12">
                <p className="text-muted-foreground mb-4">No companions found matching your criteria</p>
                <Button 
                  variant="outline" 
                  onClick={() => {
                    setSearchQuery("");
                    setSelectedFilters(['all']);
                  }}
                  data-testid="button-clear-filters"
                >
                  Clear Filters
                </Button>
              </div>
            )}

            {/* Load More */}
            {filteredCompanions.length > 0 && (
              <div className="text-center mt-6">
                <Button 
                  variant="secondary"
                  data-testid="button-load-more"
                >
                  Load More Companions
                </Button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Bottom Navigation */}
      <div className="fixed bottom-0 left-0 right-0 bg-card/80 backdrop-blur-md border-t border-border">
        <div className="flex items-center justify-around py-3">
          <button className="flex flex-col items-center space-y-1 text-primary" data-testid="nav-discover">
            <Home className="w-5 h-5" />
            <span className="text-xs">Discover</span>
          </button>
          <button className="flex flex-col items-center space-y-1 text-muted-foreground hover:text-foreground" data-testid="nav-history">
            <History className="w-5 h-5" />
            <span className="text-xs">History</span>
          </button>
          <button 
            className="flex flex-col items-center space-y-1 text-muted-foreground hover:text-foreground"
            onClick={() => setShowWalletModal(true)}
            data-testid="nav-wallet"
          >
            <Wallet className="w-5 h-5" />
            <span className="text-xs">Wallet</span>
          </button>
          <button className="flex flex-col items-center space-y-1 text-muted-foreground hover:text-foreground" data-testid="nav-profile">
            <User className="w-5 h-5" />
            <span className="text-xs">Profile</span>
          </button>
        </div>
      </div>

      {/* Modals */}
      <WalletModal 
        isOpen={showWalletModal}
        onClose={() => setShowWalletModal(false)}
        userCoinBalance={user?.coinBalance || 0}
      />
    </div>
  );
}
