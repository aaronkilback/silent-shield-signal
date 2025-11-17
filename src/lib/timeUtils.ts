/**
 * Formats minutes into days, hours, and minutes
 * @param minutes - Total minutes to format
 * @returns Formatted string like "2d 3h 45m" or "5h 30m" or "15m"
 */
export const formatMinutesToDHM = (minutes: number): string => {
  if (minutes === 0) return "0m";
  
  const days = Math.floor(minutes / (24 * 60));
  const hours = Math.floor((minutes % (24 * 60)) / 60);
  const mins = Math.floor(minutes % 60);
  
  const parts: string[] = [];
  
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (mins > 0 || parts.length === 0) parts.push(`${mins}m`);
  
  return parts.join(' ');
};

/**
 * Formats minutes into days, hours, and minutes with full labels
 * @param minutes - Total minutes to format
 * @returns Formatted string like "2 days 3 hours 45 minutes"
 */
export const formatMinutesToDHMFull = (minutes: number): string => {
  if (minutes === 0) return "0 minutes";
  
  const days = Math.floor(minutes / (24 * 60));
  const hours = Math.floor((minutes % (24 * 60)) / 60);
  const mins = Math.floor(minutes % 60);
  
  const parts: string[] = [];
  
  if (days > 0) parts.push(`${days} ${days === 1 ? 'day' : 'days'}`);
  if (hours > 0) parts.push(`${hours} ${hours === 1 ? 'hour' : 'hours'}`);
  if (mins > 0 || parts.length === 0) parts.push(`${mins} ${mins === 1 ? 'minute' : 'minutes'}`);
  
  return parts.join(' ');
};
