{{- define "aristotle.namespace" -}}
{{- .Values.global.namespace.name -}}
{{- end -}}

{{- define "aristotle.serviceAccountName" -}}
{{- .Values.global.serviceAccount.name -}}
{{- end -}}

{{- define "aristotle.image" -}}
{{- $root := index . 0 -}}
{{- $name := index . 1 -}}
{{- printf "%s/%s/%s:%s" $root.Values.global.image.registry $root.Values.global.image.repositoryPrefix $name $root.Values.global.image.tag -}}
{{- end -}}

{{- define "aristotle.commonLabels" -}}
app.kubernetes.io/name: aristotle-governance-os
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
aristotle.io/doctrine: execution-boundary-governance
{{- end -}}

{{- define "aristotle.podAnnotations" -}}
{{- if .Values.identity.mesh.inject }}
{{- toYaml .Values.identity.mesh.annotations }}
{{- end }}
{{- end -}}
