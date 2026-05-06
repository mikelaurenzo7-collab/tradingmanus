import { Button } from "@/components/ui/button";
import { AlertCircle, Home, Search } from "lucide-react";
import { useLocation } from "wouter";

export default function NotFound() {
  const [, setLocation] = useLocation();

  const handleGoHome = () => {
    setLocation("/");
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center p-4">
      <div className="glass-card w-full max-w-2xl p-8 md:p-12 text-center animate-fade-in">
        {/* Animated Illustration */}
        <div className="flex justify-center mb-8">
          <div className="relative">
            <div className="absolute inset-0 bg-violet-500/20 rounded-full blur-xl" />
            <Search className="relative w-24 h-24 text-violet-400 animate-float opacity-30" />
            <AlertCircle className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-12 h-12 text-red-400" />
          </div>
        </div>

        {/* Large 404 Display */}
        <h1 className="text-8xl md:text-9xl font-black mb-4 bg-gradient-to-r from-violet-400 via-fuchsia-400 to-pink-400 bg-clip-text text-transparent">
          404
        </h1>

        <h2 className="text-2xl md:text-3xl font-bold text-slate-100 mb-4">
          Lost in the Market
        </h2>

        <p className="text-slate-400 text-lg mb-8 max-w-md mx-auto leading-relaxed">
          The page you're looking for seems to have vanished into the void.
          Perhaps it's time to return to familiar territory.
        </p>

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
          <Button
            onClick={handleGoHome}
            className="group relative overflow-hidden bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-500 hover:to-fuchsia-500 text-white px-8 py-3 rounded-lg font-semibold transition-all duration-300 shadow-lg hover:shadow-xl hover:scale-105"
          >
            <Home className="w-5 h-5 mr-2 inline-block" />
            Return Home
          </Button>
          
          <Button
            onClick={() => window.history.back()}
            variant="outline"
            className="px-8 py-3 rounded-lg font-semibold border-slate-700 hover:border-violet-500 hover:bg-violet-500/10 transition-all duration-300"
          >
            Go Back
          </Button>
        </div>

        {/* Decorative Elements */}
        <div className="mt-12 pt-8 border-t border-white/10">
          <p className="text-sm text-slate-500">
            Error Code: <span className="font-mono text-violet-400">NOT_FOUND</span>
          </p>
        </div>
      </div>
    </div>
  );
}
