import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Shield, Mail, Users, Bot, Sparkles, ArrowRight, CheckCircle2 } from "lucide-react";

const Welcome = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-2xl p-8 md:p-12 bg-card border-border">
        {/* Header with animated shield */}
        <div className="flex flex-col items-center mb-8">
          <div className="relative mb-6">
            <div className="absolute inset-0 bg-primary/20 rounded-full blur-xl animate-pulse" />
            <div className="relative p-4 rounded-full bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/30">
              <Shield className="w-16 h-16 text-primary" />
              <Sparkles className="absolute -top-1 -right-1 w-6 h-6 text-yellow-500 animate-bounce" />
            </div>
          </div>
          
          <h1 className="text-3xl md:text-4xl font-bold text-center mb-2 text-foreground">
            Thank You for Joining Fortress!
          </h1>
          <div className="flex items-center gap-2 text-primary font-semibold">
            <CheckCircle2 className="w-5 h-5" />
            <span>Welcome to the Fortified Community!</span>
          </div>
        </div>

        {/* Welcome message */}
        <div className="space-y-4 mb-8">
          <p className="text-muted-foreground text-center leading-relaxed">
            We're absolutely thrilled you're here. In fact, the moment you clicked "join," a team of our virtual guardians gently wrapped your registration in a digital cloak of security and sent it off through the cyberspace gates with a little nod of approval.
          </p>
        </div>

        {/* What's next section */}
        <div className="space-y-4 mb-8">
          <h2 className="text-lg font-semibold text-foreground text-center mb-4">
            Here's what happens next:
          </h2>
          
          <div className="space-y-4">
            <div className="flex gap-4 p-4 rounded-lg bg-secondary/50 border border-border">
              <div className="flex-shrink-0">
                <div className="p-2 rounded-lg bg-blue-500/10">
                  <Mail className="w-5 h-5 text-blue-500" />
                </div>
              </div>
              <div>
                <h3 className="font-semibold text-foreground mb-1">Get Started</h3>
                <p className="text-sm text-muted-foreground">
                  Keep an eye on your inbox for a welcome email that's on its way to you like a digital carrier pigeon. It'll have tips, resources, and maybe a secret handshake or two.
                </p>
              </div>
            </div>

            <div className="flex gap-4 p-4 rounded-lg bg-secondary/50 border border-border">
              <div className="flex-shrink-0">
                <div className="p-2 rounded-lg bg-green-500/10">
                  <Users className="w-5 h-5 text-green-500" />
                </div>
              </div>
              <div>
                <h3 className="font-semibold text-foreground mb-1">Explore & Connect</h3>
                <p className="text-sm text-muted-foreground">
                  Dive in and say hello! Our community is filled with like-minded folks, and we'd love for you to introduce yourself.
                </p>
              </div>
            </div>

            <div className="flex gap-4 p-4 rounded-lg bg-secondary/50 border border-border">
              <div className="flex-shrink-0">
                <div className="p-2 rounded-lg bg-purple-500/10">
                  <Bot className="w-5 h-5 text-purple-500" />
                </div>
              </div>
              <div>
                <h3 className="font-semibold text-foreground mb-1">Need Help?</h3>
                <p className="text-sm text-muted-foreground">
                  Our friendly AI agents, including the ever-watchful Aegis, are standing by. If you need anything, just give a virtual shout and we'll swoop in to help.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Footer message */}
        <div className="text-center mb-8">
          <p className="text-muted-foreground italic">
            Thanks for being part of the adventure. We promise to keep it secure, strategic, and just a little bit fun.
          </p>
          <p className="text-primary font-semibold mt-2">
            Together, we are Fortified.
          </p>
        </div>

        {/* CTA Button */}
        <Button 
          onClick={() => navigate("/")} 
          className="w-full group"
          size="lg"
        >
          Enter Fortress
          <ArrowRight className="ml-2 w-4 h-4 group-hover:translate-x-1 transition-transform" />
        </Button>
      </Card>
    </div>
  );
};

export default Welcome;