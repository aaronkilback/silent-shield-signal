import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface ConversionOptions {
  documentId: string;
  filePath?: string;
  mimeType: string;
  directFileContentBase64?: string;
  targetTable?: 'archival_documents' | 'ingested_documents';
  updateDatabase?: boolean;
  // Resize options
  resizeIfLarge?: boolean;
  maxWidthPx?: number;
  maxHeightPx?: number;
  targetSizeMB?: number;
  outputFormat?: 'jpeg' | 'png' | 'webp';
  quality?: number;
  // Extract text option
  extractText?: boolean;
}

export interface ConversionResult {
  success: boolean;
  documentId: string;
  extractedTextLength?: number;
  extractedText?: string;
  resizedImage?: string;
  originalSizeMB?: number;
  resizedSizeMB?: number;
  message?: string;
  error?: string;
  details?: string;
}

export function useDocumentConverter() {
  const [isConverting, setIsConverting] = useState(false);
  const [lastResult, setLastResult] = useState<ConversionResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const convertDocument = useCallback(async (options: ConversionOptions): Promise<ConversionResult> => {
    setIsConverting(true);
    setError(null);
    
    try {
      const { data, error: invokeError } = await supabase.functions.invoke('fortress-document-converter', {
        body: options
      });

      if (invokeError) {
        const errorResult: ConversionResult = {
          success: false,
          documentId: options.documentId,
          error: invokeError.message,
          details: 'Edge function invocation failed'
        };
        setLastResult(errorResult);
        setError(invokeError.message);
        return errorResult;
      }

      const result = data as ConversionResult;
      setLastResult(result);
      
      if (!result.success) {
        setError(result.error || 'Conversion failed');
      }
      
      return result;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      const errorResult: ConversionResult = {
        success: false,
        documentId: options.documentId,
        error: errorMessage
      };
      setLastResult(errorResult);
      setError(errorMessage);
      return errorResult;
    } finally {
      setIsConverting(false);
    }
  }, []);

  const extractText = useCallback(async (
    documentId: string,
    filePath: string,
    mimeType: string,
    targetTable: 'archival_documents' | 'ingested_documents' = 'archival_documents'
  ): Promise<ConversionResult> => {
    return convertDocument({
      documentId,
      filePath,
      mimeType,
      targetTable,
      updateDatabase: true,
      extractText: true
    });
  }, [convertDocument]);

  const resizeImage = useCallback(async (
    documentId: string,
    filePath: string,
    mimeType: string,
    options?: {
      maxWidthPx?: number;
      maxHeightPx?: number;
      targetSizeMB?: number;
      outputFormat?: 'jpeg' | 'png' | 'webp';
      quality?: number;
    }
  ): Promise<ConversionResult> => {
    return convertDocument({
      documentId,
      filePath,
      mimeType,
      resizeIfLarge: true,
      extractText: false,
      updateDatabase: false,
      ...options
    });
  }, [convertDocument]);

  const resizeAndExtract = useCallback(async (
    documentId: string,
    filePath: string,
    mimeType: string,
    targetTable: 'archival_documents' | 'ingested_documents' = 'archival_documents'
  ): Promise<ConversionResult> => {
    return convertDocument({
      documentId,
      filePath,
      mimeType,
      targetTable,
      updateDatabase: true,
      resizeIfLarge: true,
      extractText: true
    });
  }, [convertDocument]);

  const convertFromBase64 = useCallback(async (
    documentId: string,
    base64Content: string,
    mimeType: string,
    options?: Partial<ConversionOptions>
  ): Promise<ConversionResult> => {
    return convertDocument({
      documentId,
      directFileContentBase64: base64Content,
      mimeType,
      updateDatabase: false,
      extractText: true,
      ...options
    });
  }, [convertDocument]);

  return {
    // State
    isConverting,
    lastResult,
    error,
    
    // Methods
    convertDocument,
    extractText,
    resizeImage,
    resizeAndExtract,
    convertFromBase64
  };
}

// Utility type for Aegis and other agents
export interface AegisDocumentTools {
  extractTextFromDocument: (storagePath: string, mimeType: string) => Promise<string>;
  resizeImage: (storagePath: string, targetSizeMB?: number) => Promise<string>;
  processDocument: (storagePath: string) => Promise<{ text: string; resizedImage?: string }>;
}

// Factory for creating Aegis-compatible document tools
export function createAegisDocumentTools(): AegisDocumentTools {
  return {
    async extractTextFromDocument(storagePath: string, mimeType: string): Promise<string> {
      const response = await supabase.functions.invoke('fortress-document-converter', {
        body: {
          documentId: crypto.randomUUID(),
          filePath: storagePath,
          mimeType,
          updateDatabase: false,
          extractText: true
        }
      });

      if (response.error || !response.data?.success) {
        throw new Error(response.data?.error || response.error?.message || 'Extraction failed');
      }

      return response.data.extractedText || '';
    },

    async resizeImage(storagePath: string, targetSizeMB = 2): Promise<string> {
      // Determine MIME type from extension
      const ext = storagePath.split('.').pop()?.toLowerCase();
      const mimeMap: Record<string, string> = {
        'jpg': 'image/jpeg',
        'jpeg': 'image/jpeg',
        'png': 'image/png',
        'webp': 'image/webp',
        'tiff': 'image/tiff',
        'tif': 'image/tiff'
      };
      const mimeType = mimeMap[ext || ''] || 'image/jpeg';

      const response = await supabase.functions.invoke('fortress-document-converter', {
        body: {
          documentId: crypto.randomUUID(),
          filePath: storagePath,
          mimeType,
          updateDatabase: false,
          resizeIfLarge: true,
          extractText: false,
          targetSizeMB
        }
      });

      if (response.error || !response.data?.success) {
        throw new Error(response.data?.error || response.error?.message || 'Resize failed');
      }

      return response.data.resizedImage || '';
    },

    async processDocument(storagePath: string): Promise<{ text: string; resizedImage?: string }> {
      // Determine MIME type from extension
      const ext = storagePath.split('.').pop()?.toLowerCase();
      const mimeMap: Record<string, string> = {
        'pdf': 'application/pdf',
        'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'doc': 'application/msword',
        'txt': 'text/plain',
        'md': 'text/markdown',
        'csv': 'text/csv',
        'jpg': 'image/jpeg',
        'jpeg': 'image/jpeg',
        'png': 'image/png',
        'webp': 'image/webp',
        'tiff': 'image/tiff',
        'tif': 'image/tiff'
      };
      const mimeType = mimeMap[ext || ''] || 'application/octet-stream';

      const response = await supabase.functions.invoke('fortress-document-converter', {
        body: {
          documentId: crypto.randomUUID(),
          filePath: storagePath,
          mimeType,
          updateDatabase: false,
          resizeIfLarge: true,
          extractText: true
        }
      });

      if (response.error || !response.data?.success) {
        throw new Error(response.data?.error || response.error?.message || 'Processing failed');
      }

      return {
        text: response.data.extractedText || '',
        resizedImage: response.data.resizedImage
      };
    }
  };
}
