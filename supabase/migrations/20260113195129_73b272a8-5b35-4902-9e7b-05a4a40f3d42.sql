-- Create enum for asset types
CREATE TYPE asset_type AS ENUM (
  'server',
  'database',
  'network_device',
  'application',
  'cloud_resource',
  'ot_device',
  'workstation',
  'container',
  'iot_device',
  'virtual_machine'
);

-- Create enum for business criticality levels
CREATE TYPE business_criticality_level AS ENUM (
  'mission_critical',
  'high',
  'medium',
  'low'
);

-- Create enum for vulnerability severity
CREATE TYPE vulnerability_severity AS ENUM (
  'critical',
  'high',
  'medium',
  'low',
  'informational'
);

-- Create enum for remediation status
CREATE TYPE remediation_status AS ENUM (
  'patch_available',
  'patch_pending',
  'mitigated',
  'patched',
  'accepted_risk',
  'investigating',
  'no_fix_available'
);

-- Create internal_assets table
CREATE TABLE public.internal_assets (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID REFERENCES public.clients(id) ON DELETE CASCADE,
  asset_name TEXT NOT NULL,
  asset_type asset_type NOT NULL,
  description TEXT,
  location TEXT,
  owner_team TEXT,
  business_criticality business_criticality_level NOT NULL DEFAULT 'medium',
  configuration_details JSONB DEFAULT '{}'::jsonb,
  network_segment TEXT,
  cloud_provider TEXT,
  cloud_service TEXT,
  is_internet_facing BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  last_patched_date TIMESTAMPTZ,
  last_scanned TIMESTAMPTZ,
  tags TEXT[] DEFAULT '{}',
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES public.profiles(id)
);

-- Create asset_vulnerabilities table
CREATE TABLE public.asset_vulnerabilities (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  asset_id UUID NOT NULL REFERENCES public.internal_assets(id) ON DELETE CASCADE,
  vulnerability_id TEXT NOT NULL,
  severity vulnerability_severity NOT NULL DEFAULT 'medium',
  cvss_score DECIMAL(3,1),
  description TEXT,
  affected_component TEXT,
  is_active_exploit_known BOOLEAN DEFAULT false,
  remediation_status remediation_status NOT NULL DEFAULT 'investigating',
  remediation_notes TEXT,
  discovered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  patched_at TIMESTAMPTZ,
  due_date TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create indexes for performance
CREATE INDEX idx_internal_assets_client_id ON public.internal_assets(client_id);
CREATE INDEX idx_internal_assets_asset_type ON public.internal_assets(asset_type);
CREATE INDEX idx_internal_assets_business_criticality ON public.internal_assets(business_criticality);
CREATE INDEX idx_internal_assets_asset_name ON public.internal_assets(asset_name);
CREATE INDEX idx_internal_assets_is_active ON public.internal_assets(is_active);
CREATE INDEX idx_internal_assets_tags ON public.internal_assets USING GIN(tags);
CREATE INDEX idx_internal_assets_configuration ON public.internal_assets USING GIN(configuration_details);

CREATE INDEX idx_asset_vulnerabilities_asset_id ON public.asset_vulnerabilities(asset_id);
CREATE INDEX idx_asset_vulnerabilities_vulnerability_id ON public.asset_vulnerabilities(vulnerability_id);
CREATE INDEX idx_asset_vulnerabilities_severity ON public.asset_vulnerabilities(severity);
CREATE INDEX idx_asset_vulnerabilities_remediation_status ON public.asset_vulnerabilities(remediation_status);
CREATE INDEX idx_asset_vulnerabilities_is_active_exploit ON public.asset_vulnerabilities(is_active_exploit_known);

-- Full-text search indexes
CREATE INDEX idx_internal_assets_name_search ON public.internal_assets USING GIN(to_tsvector('english', asset_name));
CREATE INDEX idx_internal_assets_description_search ON public.internal_assets USING GIN(to_tsvector('english', COALESCE(description, '')));
CREATE INDEX idx_asset_vulnerabilities_description_search ON public.asset_vulnerabilities USING GIN(to_tsvector('english', COALESCE(description, '')));

-- Enable RLS
ALTER TABLE public.internal_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.asset_vulnerabilities ENABLE ROW LEVEL SECURITY;

-- RLS policies for internal_assets
CREATE POLICY "Authenticated users can view internal assets"
  ON public.internal_assets FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Analysts and admins can insert internal assets"
  ON public.internal_assets FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid() AND role IN ('admin', 'analyst', 'super_admin')
    )
  );

CREATE POLICY "Analysts and admins can update internal assets"
  ON public.internal_assets FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid() AND role IN ('admin', 'analyst', 'super_admin')
    )
  );

CREATE POLICY "Admins can delete internal assets"
  ON public.internal_assets FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid() AND role IN ('admin', 'super_admin')
    )
  );

-- RLS policies for asset_vulnerabilities
CREATE POLICY "Authenticated users can view asset vulnerabilities"
  ON public.asset_vulnerabilities FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Analysts and admins can insert asset vulnerabilities"
  ON public.asset_vulnerabilities FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid() AND role IN ('admin', 'analyst', 'super_admin')
    )
  );

CREATE POLICY "Analysts and admins can update asset vulnerabilities"
  ON public.asset_vulnerabilities FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid() AND role IN ('admin', 'analyst', 'super_admin')
    )
  );

CREATE POLICY "Admins can delete asset vulnerabilities"
  ON public.asset_vulnerabilities FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid() AND role IN ('admin', 'super_admin')
    )
  );

-- Triggers for updated_at
CREATE TRIGGER update_internal_assets_updated_at
  BEFORE UPDATE ON public.internal_assets
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_asset_vulnerabilities_updated_at
  BEFORE UPDATE ON public.asset_vulnerabilities
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Insert sample data for Petronas context
INSERT INTO public.internal_assets (asset_name, asset_type, description, location, owner_team, business_criticality, configuration_details, network_segment, is_internet_facing, tags) VALUES
('prod-webserver-01', 'server', 'Primary production web server hosting customer portal', 'Azure_EastUS', 'Web Infrastructure Team', 'high', '{"os": "Ubuntu 22.04 LTS", "software_installed": ["nginx 1.24", "nodejs 20.x", "pm2"], "cpu_cores": 8, "ram_gb": 32}', 'DMZ', true, ARRAY['PCI_scope', 'internet_facing', 'production']),
('SCADA-PLC-5', 'ot_device', 'Programmable Logic Controller for LNG processing train 2', 'LNG_Plant_Train2', 'OT Security Team', 'mission_critical', '{"manufacturer": "Siemens", "model": "S7-1500", "firmware_version": "2.9.4", "protocol": "Modbus TCP"}', 'OT_Network_Isolated', false, ARRAY['ot_critical', 'scada', 'lng_operations']),
('Petronas_ERP_System', 'application', 'SAP S/4HANA Enterprise Resource Planning system', 'KL_DataCenter_Rack3', 'Enterprise Applications Team', 'mission_critical', '{"os": "SUSE Linux Enterprise 15", "software_installed": ["SAP S/4HANA 2023", "SAP HANA DB 2.0"], "database": "HANA"}', 'Corporate_Internal', false, ARRAY['erp', 'financial_data', 'hr_data', 'mission_critical']),
('db-analytics-cluster-01', 'database', 'Snowflake data warehouse for business analytics', 'AWS_Singapore', 'Data Engineering Team', 'high', '{"platform": "Snowflake", "warehouse_size": "X-Large", "storage_tb": 50, "encryption": "AES-256"}', 'Cloud_Analytics', false, ARRAY['analytics', 'business_intelligence', 'data_warehouse']),
('fw-perimeter-01', 'network_device', 'Primary perimeter firewall for KL headquarters', 'KL_DataCenter_Core', 'Network Security Team', 'mission_critical', '{"manufacturer": "Palo Alto", "model": "PA-5450", "software_version": "11.1.2", "ha_mode": "active-passive"}', 'Perimeter', true, ARRAY['firewall', 'perimeter_security', 'critical_infrastructure']),
('k8s-prod-cluster', 'container', 'Production Kubernetes cluster for microservices', 'Azure_SoutheastAsia', 'Platform Engineering', 'high', '{"platform": "AKS", "version": "1.28", "node_count": 12, "node_size": "Standard_D8s_v3"}', 'Cloud_Production', false, ARRAY['kubernetes', 'microservices', 'containerized']),
('vpn-gateway-hq', 'network_device', 'VPN gateway for remote worker access', 'KL_DataCenter_DMZ', 'Network Operations', 'high', '{"manufacturer": "Cisco", "model": "ASA 5555-X", "software_version": "9.18.2", "max_connections": 5000}', 'DMZ', true, ARRAY['vpn', 'remote_access', 'internet_facing']),
('iot-sensor-array-refinery', 'iot_device', 'Industrial IoT sensors for refinery monitoring', 'Melaka_Refinery', 'Industrial IoT Team', 'medium', '{"sensor_count": 250, "protocol": "MQTT", "gateway": "AWS IoT Greengrass", "data_frequency": "1s"}', 'OT_IoT_Network', false, ARRAY['iot', 'refinery', 'sensor_data']);

-- Insert sample vulnerabilities
INSERT INTO public.asset_vulnerabilities (asset_id, vulnerability_id, severity, cvss_score, description, affected_component, is_active_exploit_known, remediation_status) 
SELECT 
  id, 
  'CVE-2024-3094', 
  'critical'::vulnerability_severity, 
  10.0, 
  'XZ Utils backdoor - Critical supply chain compromise affecting SSH authentication', 
  'xz-utils', 
  true, 
  'patch_available'::remediation_status
FROM public.internal_assets WHERE asset_name = 'prod-webserver-01';

INSERT INTO public.asset_vulnerabilities (asset_id, vulnerability_id, severity, cvss_score, description, affected_component, is_active_exploit_known, remediation_status)
SELECT 
  id, 
  'CVE-2023-44487', 
  'high'::vulnerability_severity, 
  7.5, 
  'HTTP/2 Rapid Reset Attack - DDoS vulnerability in nginx', 
  'nginx', 
  true, 
  'mitigated'::remediation_status
FROM public.internal_assets WHERE asset_name = 'prod-webserver-01';

INSERT INTO public.asset_vulnerabilities (asset_id, vulnerability_id, severity, cvss_score, description, affected_component, is_active_exploit_known, remediation_status)
SELECT 
  id, 
  'CVE-2024-21762', 
  'critical'::vulnerability_severity, 
  9.8, 
  'Fortinet FortiOS out-of-bound write vulnerability allowing RCE', 
  'FortiOS SSL VPN', 
  true, 
  'patch_pending'::remediation_status
FROM public.internal_assets WHERE asset_name = 'vpn-gateway-hq';

INSERT INTO public.asset_vulnerabilities (asset_id, vulnerability_id, severity, cvss_score, description, affected_component, is_active_exploit_known, remediation_status)
SELECT 
  id, 
  'INTERNAL-OT-2024-001', 
  'high'::vulnerability_severity, 
  8.1, 
  'Siemens S7-1500 authentication bypass in legacy protocol mode', 
  'S7-1500 CPU Firmware', 
  false, 
  'mitigated'::remediation_status
FROM public.internal_assets WHERE asset_name = 'SCADA-PLC-5';

INSERT INTO public.asset_vulnerabilities (asset_id, vulnerability_id, severity, cvss_score, description, affected_component, is_active_exploit_known, remediation_status)
SELECT 
  id, 
  'CVE-2024-22252', 
  'critical'::vulnerability_severity, 
  9.3, 
  'SAP Security Note - Remote code execution in SAP NetWeaver', 
  'SAP NetWeaver ABAP', 
  true, 
  'investigating'::remediation_status
FROM public.internal_assets WHERE asset_name = 'Petronas_ERP_System';