import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Volume2, Mic } from "lucide-react";

export const VoiceSettings = () => {
  const { toast } = useToast();
  const [isSaving, setIsSaving] = useState(false);
  const [isTestingVoice, setIsTestingVoice] = useState(false);
  
  const [settings, setSettings] = useState({
    voiceEnabled: true,
    ttsModel: "tts-1-hd",
    voice: "onyx",
    sampleRate: 44100,
    outputFormat: "mp3",
    chunkSize: 2000,
    volume: 80,
    speed: 1.0,
    autoPlayResponses: true,
    dictationEnabled: true,
  });

  const voices = [
    { id: "onyx", name: "Onyx", description: "Deep, authoritative male voice" },
    { id: "alloy", name: "Alloy", description: "Neutral, balanced voice" },
    { id: "echo", name: "Echo", description: "Warm, conversational male voice" },
    { id: "fable", name: "Fable", description: "Expressive, storytelling voice" },
    { id: "nova", name: "Nova", description: "Friendly, professional female voice" },
    { id: "shimmer", name: "Shimmer", description: "Clear, articulate female voice" },
  ];

  const handleSave = async () => {
    setIsSaving(true);
    try {
      // Save settings to localStorage for now
      localStorage.setItem("fortress_voice_settings", JSON.stringify(settings));
      toast({ title: "Settings Saved", description: "Voice settings updated successfully" });
    } catch (error) {
      toast({ 
        title: "Save Failed", 
        description: "Failed to save voice settings",
        variant: "destructive" 
      });
    } finally {
      setIsSaving(false);
    }
  };

  const testVoice = async () => {
    setIsTestingVoice(true);
    try {
      // Use browser's speech synthesis for quick test
      const utterance = new SpeechSynthesisUtterance(
        "Aegis voice system initialized. Standing by for intelligence briefing."
      );
      utterance.rate = settings.speed;
      utterance.volume = settings.volume / 100;
      speechSynthesis.speak(utterance);
      
      toast({ title: "Voice Test", description: "Playing test audio..." });
    } catch (error) {
      toast({ 
        title: "Test Failed", 
        description: "Could not play test audio",
        variant: "destructive" 
      });
    } finally {
      setTimeout(() => setIsTestingVoice(false), 2000);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium">Voice Settings</h3>
        <p className="text-sm text-muted-foreground">
          Configure Aegis voice assistant and text-to-speech settings
        </p>
      </div>

      <Separator />

      <Card className="p-6 space-y-6">
        {/* Voice Enable Toggle */}
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <Label>Voice Assistant</Label>
            <p className="text-sm text-muted-foreground">
              Enable Aegis voice capabilities for briefings and interactions
            </p>
          </div>
          <Switch
            checked={settings.voiceEnabled}
            onCheckedChange={(checked) => setSettings({ ...settings, voiceEnabled: checked })}
          />
        </div>

        <Separator />

        {/* TTS Model Selection */}
        <div className="space-y-2">
          <Label>TTS Model</Label>
          <p className="text-sm text-muted-foreground">
            Select the text-to-speech model quality
          </p>
          <Select 
            value={settings.ttsModel} 
            onValueChange={(value) => setSettings({ ...settings, ttsModel: value })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="tts-1">TTS-1 (Standard)</SelectItem>
              <SelectItem value="tts-1-hd">TTS-1-HD (High Definition)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Separator />

        {/* Voice Selection */}
        <div className="space-y-2">
          <Label>Voice Profile</Label>
          <p className="text-sm text-muted-foreground">
            Choose the voice character for Aegis responses
          </p>
          <Select 
            value={settings.voice} 
            onValueChange={(value) => setSettings({ ...settings, voice: value })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {voices.map((voice) => (
                <SelectItem key={voice.id} value={voice.id}>
                  <div className="flex flex-col">
                    <span className="font-medium">{voice.name}</span>
                    <span className="text-xs text-muted-foreground">{voice.description}</span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {settings.voice === "onyx" && (
            <p className="text-xs text-primary mt-1">
              ★ Recommended: Deep, authoritative voice optimized for intelligence briefings
            </p>
          )}
        </div>

        <Separator />

        {/* Volume Control */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label>Volume</Label>
            <span className="text-sm text-muted-foreground">{settings.volume}%</span>
          </div>
          <Slider
            value={[settings.volume]}
            onValueChange={(value) => setSettings({ ...settings, volume: value[0] })}
            max={100}
            min={0}
            step={5}
          />
        </div>

        <Separator />

        {/* Speed Control */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label>Speech Rate</Label>
            <span className="text-sm text-muted-foreground">{settings.speed.toFixed(1)}x</span>
          </div>
          <Slider
            value={[settings.speed * 100]}
            onValueChange={(value) => setSettings({ ...settings, speed: value[0] / 100 })}
            max={150}
            min={50}
            step={10}
          />
          <p className="text-xs text-muted-foreground">
            Measured, deliberate pacing recommended for intelligence briefings
          </p>
        </div>

        <Separator />

        {/* Auto-play Responses */}
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <Label>Auto-play Responses</Label>
            <p className="text-sm text-muted-foreground">
              Automatically speak AI responses aloud
            </p>
          </div>
          <Switch
            checked={settings.autoPlayResponses}
            onCheckedChange={(checked) => setSettings({ ...settings, autoPlayResponses: checked })}
          />
        </div>

        <Separator />

        {/* Dictation */}
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <Label>Voice Dictation</Label>
            <p className="text-sm text-muted-foreground">
              Enable speech-to-text for voice input
            </p>
          </div>
          <Switch
            checked={settings.dictationEnabled}
            onCheckedChange={(checked) => setSettings({ ...settings, dictationEnabled: checked })}
          />
        </div>

        <Separator />

        {/* Technical Settings */}
        <div className="space-y-4">
          <Label className="text-sm font-medium">Technical Settings</Label>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Sample Rate</Label>
              <Select 
                value={settings.sampleRate.toString()} 
                onValueChange={(value) => setSettings({ ...settings, sampleRate: parseInt(value) })}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="22050">22.05 kHz</SelectItem>
                  <SelectItem value="44100">44.1 kHz</SelectItem>
                  <SelectItem value="48000">48 kHz</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Output Format</Label>
              <Select 
                value={settings.outputFormat} 
                onValueChange={(value) => setSettings({ ...settings, outputFormat: value })}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="mp3">MP3</SelectItem>
                  <SelectItem value="opus">Opus</SelectItem>
                  <SelectItem value="aac">AAC</SelectItem>
                  <SelectItem value="flac">FLAC</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Chunk Size (characters)</Label>
            <Slider
              value={[settings.chunkSize]}
              onValueChange={(value) => setSettings({ ...settings, chunkSize: value[0] })}
              max={4000}
              min={500}
              step={100}
            />
            <p className="text-xs text-muted-foreground">
              {settings.chunkSize} chars max per request (2000 recommended for reliability)
            </p>
          </div>
        </div>
      </Card>

      <div className="flex justify-between">
        <Button variant="outline" onClick={testVoice} disabled={isTestingVoice}>
          {isTestingVoice ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          ) : (
            <Volume2 className="w-4 h-4 mr-2" />
          )}
          Test Voice
        </Button>
        <Button onClick={handleSave} disabled={isSaving}>
          {isSaving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
          Save Settings
        </Button>
      </div>
    </div>
  );
};
