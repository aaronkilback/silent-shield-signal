// Major Case Management (MCM) Role definitions
// Based on the Command Triangle methodology

export type MCMRole = 
  | 'team_commander'
  | 'primary_investigator'
  | 'file_coordinator'
  | 'investigator'
  | 'analyst'
  | 'viewer';

export interface MCMRoleInfo {
  value: MCMRole;
  label: string;
  shortLabel: string;
  description: string;
  permissions: string[];
  badgeVariant: 'default' | 'secondary' | 'outline' | 'destructive';
}

export const MCM_ROLES: Record<MCMRole, MCMRoleInfo> = {
  team_commander: {
    value: 'team_commander',
    label: 'Team Commander',
    shortLabel: 'TC',
    description: 'Strategic oversight, approve actions, reassign investigators, close case',
    permissions: ['approve_actions', 'manage_assignments', 'manage_evidence', 'submit_findings', 'add_analysis', 'view'],
    badgeVariant: 'destructive',
  },
  primary_investigator: {
    value: 'primary_investigator',
    label: 'Primary Investigator',
    shortLabel: 'PI',
    description: 'Day-to-day tactical lead, create tasks, link signals, manage timeline',
    permissions: ['manage_assignments', 'manage_evidence', 'submit_findings', 'add_analysis', 'view'],
    badgeVariant: 'default',
  },
  file_coordinator: {
    value: 'file_coordinator',
    label: 'File Coordinator',
    shortLabel: 'FC',
    description: 'Evidence management, upload documents, manage attachments, audit trail',
    permissions: ['manage_evidence', 'submit_findings', 'add_analysis', 'view'],
    badgeVariant: 'default',
  },
  investigator: {
    value: 'investigator',
    label: 'Investigator',
    shortLabel: 'INV',
    description: 'Line staff, submit findings, update investigation entries',
    permissions: ['submit_findings', 'add_analysis', 'view'],
    badgeVariant: 'secondary',
  },
  analyst: {
    value: 'analyst',
    label: 'Analyst',
    shortLabel: 'ANL',
    description: 'Support role, read access, add analysis notes',
    permissions: ['add_analysis', 'view'],
    badgeVariant: 'secondary',
  },
  viewer: {
    value: 'viewer',
    label: 'Viewer',
    shortLabel: 'VWR',
    description: 'Read-only access for stakeholders and observers',
    permissions: ['view'],
    badgeVariant: 'outline',
  },
};

export const MCM_ROLE_ORDER: MCMRole[] = [
  'team_commander',
  'primary_investigator',
  'file_coordinator',
  'investigator',
  'analyst',
  'viewer',
];

// Permission check helpers
export function hasPermission(role: MCMRole, permission: string): boolean {
  return MCM_ROLES[role]?.permissions.includes(permission) ?? false;
}

export function canApproveActions(role: MCMRole): boolean {
  return hasPermission(role, 'approve_actions');
}

export function canManageAssignments(role: MCMRole): boolean {
  return hasPermission(role, 'manage_assignments');
}

export function canManageEvidence(role: MCMRole): boolean {
  return hasPermission(role, 'manage_evidence');
}

export function canSubmitFindings(role: MCMRole): boolean {
  return hasPermission(role, 'submit_findings');
}

export function canAddAnalysis(role: MCMRole): boolean {
  return hasPermission(role, 'add_analysis');
}

// Get role info with fallback
export function getMCMRoleInfo(role: string | null | undefined): MCMRoleInfo {
  if (role && role in MCM_ROLES) {
    return MCM_ROLES[role as MCMRole];
  }
  return MCM_ROLES.viewer;
}
