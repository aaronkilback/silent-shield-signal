import * as React from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { X, ZoomIn, ZoomOut, RotateCw, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ImageLightboxProps {
  src: string;
  alt?: string;
  className?: string;
  containerClassName?: string;
}

export function ImageLightbox({ src, alt = "Image", className, containerClassName }: ImageLightboxProps) {
  const [open, setOpen] = React.useState(false);
  const [zoom, setZoom] = React.useState(1);
  const [rotation, setRotation] = React.useState(0);

  const handleZoomIn = () => setZoom(prev => Math.min(prev + 0.25, 3));
  const handleZoomOut = () => setZoom(prev => Math.max(prev - 0.25, 0.5));
  const handleRotate = () => setRotation(prev => (prev + 90) % 360);
  
  const handleDownload = async () => {
    try {
      const response = await fetch(src);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = alt || 'image';
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error('Failed to download image:', error);
    }
  };

  const resetView = () => {
    setZoom(1);
    setRotation(0);
  };

  return (
    <>
      <div 
        className={cn("cursor-pointer group relative block", containerClassName)}
        onClick={() => setOpen(true)}
      >
        <img 
          src={src} 
          alt={alt} 
          className={cn("transition-transform", className)}
        />
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
          <ZoomIn className="w-6 h-6 text-white drop-shadow-lg" />
        </div>
      </div>

      <ImageLightboxDialog
        open={open}
        onOpenChange={(isOpen) => { setOpen(isOpen); if (!isOpen) resetView(); }}
        src={src}
        alt={alt}
        zoom={zoom}
        rotation={rotation}
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onRotate={handleRotate}
        onDownload={handleDownload}
      />
    </>
  );
}

// Standalone button trigger for cases where you don't want to wrap the image
interface ImageLightboxTriggerProps {
  src: string;
  alt?: string;
  className?: string;
}

export function ImageLightboxTrigger({ src, alt = "Image", className }: ImageLightboxTriggerProps) {
  const [open, setOpen] = React.useState(false);
  const [zoom, setZoom] = React.useState(1);
  const [rotation, setRotation] = React.useState(0);

  const handleZoomIn = () => setZoom(prev => Math.min(prev + 0.25, 3));
  const handleZoomOut = () => setZoom(prev => Math.max(prev - 0.25, 0.5));
  const handleRotate = () => setRotation(prev => (prev + 90) % 360);
  
  const handleDownload = async () => {
    try {
      const response = await fetch(src);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = alt || 'image';
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error('Failed to download image:', error);
    }
  };

  const resetView = () => {
    setZoom(1);
    setRotation(0);
  };

  return (
    <>
      <Button
        variant="secondary"
        size="icon"
        className={cn("h-8 w-8", className)}
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
      >
        <ZoomIn className="w-4 h-4" />
      </Button>

      <ImageLightboxDialog
        open={open}
        onOpenChange={(isOpen) => { setOpen(isOpen); if (!isOpen) resetView(); }}
        src={src}
        alt={alt}
        zoom={zoom}
        rotation={rotation}
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onRotate={handleRotate}
        onDownload={handleDownload}
      />
    </>
  );
}

// Shared dialog component
interface ImageLightboxDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  src: string;
  alt: string;
  zoom: number;
  rotation: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onRotate: () => void;
  onDownload: () => void;
}

function ImageLightboxDialog({ 
  open, 
  onOpenChange, 
  src, 
  alt, 
  zoom, 
  rotation,
  onZoomIn,
  onZoomOut,
  onRotate,
  onDownload
}: ImageLightboxDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[100vw] max-h-[100vh] w-[100vw] h-[100vh] p-0 bg-black/95 border-none overflow-hidden [&>button]:hidden">
        <VisuallyHidden>
          <DialogTitle>{alt}</DialogTitle>
        </VisuallyHidden>
        
        {/* Toolbar */}
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-1 sm:gap-2 bg-black/70 backdrop-blur-sm rounded-full px-3 sm:px-4 py-2">
          <Button 
            variant="ghost" 
            size="icon" 
            className="h-8 w-8 text-white hover:bg-white/20"
            onClick={onZoomOut}
          >
            <ZoomOut className="h-4 w-4" />
          </Button>
          <span className="text-white text-sm min-w-[4ch] text-center">{Math.round(zoom * 100)}%</span>
          <Button 
            variant="ghost" 
            size="icon" 
            className="h-8 w-8 text-white hover:bg-white/20"
            onClick={onZoomIn}
          >
            <ZoomIn className="h-4 w-4" />
          </Button>
          <div className="w-px h-4 bg-white/30" />
          <Button 
            variant="ghost" 
            size="icon" 
            className="h-8 w-8 text-white hover:bg-white/20"
            onClick={onRotate}
          >
            <RotateCw className="h-4 w-4" />
          </Button>
          <Button 
            variant="ghost" 
            size="icon" 
            className="h-8 w-8 text-white hover:bg-white/20"
            onClick={onDownload}
          >
            <Download className="h-4 w-4" />
          </Button>
          <div className="w-px h-4 bg-white/30" />
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-white hover:bg-white/20"
            onClick={() => onOpenChange(false)}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Image container */}
        <div 
          className="w-full h-full flex items-center justify-center p-4 pt-16 overflow-auto"
          onClick={(e) => { if (e.target === e.currentTarget) onOpenChange(false); }}
        >
          <img
            src={src}
            alt={alt}
            className="max-w-full max-h-full object-contain transition-transform duration-200"
            style={{ 
              transform: `scale(${zoom}) rotate(${rotation}deg)`,
            }}
            draggable={false}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
