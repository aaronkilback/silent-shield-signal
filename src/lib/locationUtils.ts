/**
 * Parse Google Maps and Google Earth URLs to extract location information
 * Supports various Google Maps URL formats including:
 * - google.com/maps/@lat,lng,zoom
 * - google.com/maps/place/Name/@lat,lng
 * - google.com/maps?q=lat,lng
 * - earth.google.com/web/@lat,lng,elevation,heading,tilt
 */
export function parseGoogleMapsUrl(url: string): {
  coordinates?: string;
  address?: string;
  placeName?: string;
} | null {
  try {
    // Check if it's a Google Maps or Earth URL
    if (!url.includes('google.com/maps') && !url.includes('earth.google.com')) {
      return null;
    }

    const result: {
      coordinates?: string;
      address?: string;
      placeName?: string;
    } = {};

    // Pattern 1: /@lat,lng format
    const coordPattern = /@(-?\d+\.\d+),(-?\d+\.\d+)/;
    const coordMatch = url.match(coordPattern);
    
    if (coordMatch) {
      const lat = coordMatch[1];
      const lng = coordMatch[2];
      result.coordinates = `${lat}, ${lng}`;
    }

    // Pattern 2: /place/PlaceName format
    const placePattern = /\/place\/([^/@]+)/;
    const placeMatch = url.match(placePattern);
    
    if (placeMatch) {
      // Decode URI component and replace + with spaces
      const placeName = decodeURIComponent(placeMatch[1]).replace(/\+/g, ' ');
      result.placeName = placeName;
      result.address = placeName;
    }

    // Pattern 3: ?q=query format
    const queryPattern = /[?&]q=([^&]+)/;
    const queryMatch = url.match(queryPattern);
    
    if (queryMatch && !result.address) {
      const query = decodeURIComponent(queryMatch[1]).replace(/\+/g, ' ');
      
      // Check if query is coordinates
      const coordInQuery = query.match(/(-?\d+\.\d+),\s*(-?\d+\.\d+)/);
      if (coordInQuery) {
        result.coordinates = `${coordInQuery[1]}, ${coordInQuery[2]}`;
      } else {
        result.address = query;
      }
    }

    // If we found anything, return it
    if (result.coordinates || result.address || result.placeName) {
      return result;
    }

    return null;
  } catch (error) {
    console.error('Error parsing Google Maps URL:', error);
    return null;
  }
}

/**
 * Format location string from parsed data
 */
export function formatLocationFromUrl(parsed: ReturnType<typeof parseGoogleMapsUrl>): string {
  if (!parsed) return '';
  
  const parts = [];
  
  if (parsed.placeName) {
    parts.push(parsed.placeName);
  } else if (parsed.address) {
    parts.push(parsed.address);
  }
  
  if (parsed.coordinates && parsed.coordinates !== parsed.address) {
    parts.push(`(${parsed.coordinates})`);
  }
  
  return parts.join(' ');
}
