{{- define "avw-web.name" -}}
{{- printf "%s-%s" (.Release.Name | trunc 40 | trimSuffix "-") "web" -}}
{{- end -}}

{{- define "avw-web.labels" -}}
app.kubernetes.io/name: avw-web
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version }}
{{- end -}}

{{- define "avw-web.selector" -}}
app.kubernetes.io/name: avw-web
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}
