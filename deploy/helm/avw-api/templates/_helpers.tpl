{{- define "avw-api.name" -}}
{{- printf "%s-%s" (.Release.Name | trunc 40 | trimSuffix "-") "api" -}}
{{- end -}}

{{- define "avw-api.image" -}}
{{ .Values.image.repository }}:{{ .Values.image.tag | default .Chart.AppVersion }}
{{- end -}}

{{- define "avw-api.labels" -}}
app.kubernetes.io/name: avw-api
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version }}
{{- end -}}

{{- define "avw-api.selector" -}}
app.kubernetes.io/name: avw-api
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{/* Secret name: the pre-created one, or the one this chart creates for local clusters. */}}
{{- define "avw-api.secretName" -}}
{{- .Values.secrets.existingSecret -}}
{{- end -}}

{{/* Environment shared by the API, the worker and the migration job. */}}
{{- define "avw-api.env" -}}
- name: ASPNETCORE_ENVIRONMENT
  value: Production
- name: DOTNET_ENVIRONMENT
  value: Production
- name: ConnectionStrings__Default
  valueFrom:
    secretKeyRef:
      name: {{ include "avw-api.secretName" . }}
      key: ConnectionStrings__Default
{{- end -}}

{{/* API-only settings. */}}
{{- define "avw-api.apiEnv" -}}
- name: Auth__Authority
  value: {{ .Values.auth.authority | quote }}
- name: Auth__ClientId
  value: {{ .Values.auth.clientId | quote }}
- name: Auth__ClientSecret
  valueFrom:
    secretKeyRef:
      name: {{ include "avw-api.secretName" . }}
      key: Auth__ClientSecret
- name: Elasticsearch__Url
  value: {{ .Values.elasticsearch.url | quote }}
- name: Elasticsearch__ContactsIndex
  value: {{ .Values.elasticsearch.contactsIndex | quote }}
{{- if .Values.elasticsearch.caSecret }}
- name: Elasticsearch__CaCertificatePath
  value: /etc/avw/es-ca/ca.crt
{{- end }}
- name: Elasticsearch__PersonnelIndex
  value: {{ .Values.elasticsearch.personnelIndex | quote }}
- name: Elasticsearch__SearchPermitsPerMinute
  value: {{ .Values.elasticsearch.searchPermitsPerMinute | quote }}
{{- if .Values.smtp.host }}
- name: Smtp__Host
  value: {{ .Values.smtp.host | quote }}
- name: Smtp__Port
  value: {{ .Values.smtp.port | quote }}
- name: Smtp__UseSsl
  value: {{ .Values.smtp.useSsl | quote }}
- name: Smtp__From
  value: {{ .Values.smtp.from | quote }}
{{- if .Values.smtp.user }}
- name: Smtp__User
  value: {{ .Values.smtp.user | quote }}
- name: Smtp__Password
  valueFrom:
    secretKeyRef:
      name: {{ include "avw-api.secretName" . }}
      key: Smtp__Password
      optional: true
{{- end }}
{{- end }}
{{- range $i, $email := .Values.notifications.editorEmails }}
- name: {{ printf "Notifications__EditorEmails__%d" $i }}
  value: {{ $email | quote }}
{{- end }}
{{- if .Values.notifications.siteUrl }}
- name: Notifications__SiteUrl
  value: {{ .Values.notifications.siteUrl | quote }}
{{- end }}
- name: Elasticsearch__ApiKey
  valueFrom:
    secretKeyRef:
      name: {{ include "avw-api.secretName" . }}
      key: Elasticsearch__ApiKey
      optional: true
- name: DataProtection__CertificatePath
  value: /etc/avw/keys/key-protection.pfx
- name: DataProtection__CertificatePassword
  valueFrom:
    secretKeyRef:
      name: {{ include "avw-api.secretName" . }}
      key: DataProtection__CertificatePassword
{{- if .Values.media.enabled }}
- name: Media__RootPath
  value: {{ .Values.media.mountPath | quote }}
- name: Media__KeepOriginals
  value: {{ .Values.media.keepOriginals | quote }}
{{- end }}
{{- if .Values.scratch.enabled }}
# ASP.NET buffers large uploads to TMPDIR; keep that on the per-pod scratch volume, not the root filesystem.
- name: TMPDIR
  value: {{ .Values.scratch.mountPath | quote }}
- name: MAGICK_TEMPORARY_PATH
  value: {{ .Values.scratch.mountPath | quote }}
- name: Media__ScratchPath
  value: {{ .Values.scratch.mountPath | quote }}
- name: Media__MaxUploadBytes
  value: {{ .Values.scratch.maxUploadBytes | quote }}
- name: Media__MaxConcurrentUploads
  value: {{ .Values.scratch.maxConcurrentUploads | quote }}
{{- end }}
{{- end -}}

{{/* Volumes. `tmp` exists so the root filesystem can be read-only. */}}
{{- define "avw-api.volumes" -}}
- name: tmp
  emptyDir: {}
{{- if .Values.media.enabled }}
- name: media
{{- if eq .Values.media.storage.type "nfs" }}
  nfs:
    server: {{ required "media.storage.nfs.server is required" .Values.media.storage.nfs.server }}
    path: {{ required "media.storage.nfs.path is required" .Values.media.storage.nfs.path }}
{{- else }}
  persistentVolumeClaim:
    claimName: {{ if eq .Values.media.storage.type "existingClaim" }}{{ required "media.storage.existingClaim is required" .Values.media.storage.existingClaim }}{{ else }}{{ include "avw-api.name" . }}-media{{ end }}
{{- end }}
{{- end }}
{{- end -}}

{{/* Opt-in root init container that makes the media mount writable by the app user (see media.fixPermissions). */}}
{{- define "avw-api.mediaPermissionsInit" -}}
{{- if and .Values.media.enabled .Values.media.fixPermissions.enabled -}}
initContainers:
  - name: media-permissions
    image: {{ .Values.media.fixPermissions.image }}
    imagePullPolicy: IfNotPresent
    # Logs the mount's owner and mode before and after, so a failure can be read from this container's log.
    command:
      - sh
      - -c
      - |
        set -e
        echo "before: $(stat -c '%a %u:%g' "$2")"
        chown {{ if .Values.media.fixPermissions.recursive }}-R {{ end }}"$1" "$2"
        chmod {{ if .Values.media.fixPermissions.recursive }}-R u+rwX{{ else }}u+rwx{{ end }} "$2"
        echo "after:  $(stat -c '%a %u:%g' "$2")"
      - media-permissions
      - {{ printf "%v:%v" .Values.podSecurityContext.runAsUser (.Values.podSecurityContext.fsGroup | default .Values.podSecurityContext.runAsUser) | quote }}
      - {{ .Values.media.mountPath | quote }}
    securityContext:
      runAsUser: 0
      runAsNonRoot: false
      allowPrivilegeEscalation: false
      readOnlyRootFilesystem: true
      capabilities:
        drop: [ALL]
        add: [CHOWN, FOWNER]
    resources:
      requests: { cpu: 10m, memory: 16Mi }
      limits: { memory: 64Mi }
    volumeMounts:
      - name: media
        mountPath: {{ .Values.media.mountPath }}
{{- end }}
{{- end -}}

{{- define "avw-api.volumeMounts" -}}
- name: tmp
  mountPath: /tmp
{{- if .Values.media.enabled }}
- name: media
  mountPath: {{ .Values.media.mountPath }}
{{- end }}
{{- end -}}

{{/* Per-pod scratch volume: only the API pods use it. */}}
{{- define "avw-api.scratchVolume" -}}
{{- if .Values.scratch.enabled }}
- name: scratch
{{- if eq .Values.scratch.type "ephemeralPvc" }}
  ephemeral:
    volumeClaimTemplate:
      spec:
        accessModes: {{ toYaml .Values.scratch.ephemeralPvc.accessModes | nindent 10 }}
        {{- with .Values.scratch.ephemeralPvc.storageClassName }}
        storageClassName: {{ . | quote }}
        {{- end }}
        resources:
          requests:
            storage: {{ .Values.scratch.ephemeralPvc.size }}
{{- else }}
  emptyDir:
    sizeLimit: {{ .Values.scratch.emptyDir.sizeLimit }}
{{- end }}
{{- end }}
{{- end -}}

{{- define "avw-api.scratchMount" -}}
{{- if .Values.scratch.enabled }}
- name: scratch
  mountPath: {{ .Values.scratch.mountPath }}
{{- end }}
{{- end -}}

{{- define "avw-api.containerSecurity" -}}
allowPrivilegeEscalation: false
readOnlyRootFilesystem: true
capabilities:
  drop: [ALL]
{{- end -}}
