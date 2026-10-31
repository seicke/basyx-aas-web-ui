<template>
  <EdcResourceTab
    :create-actions="createActions"
    icon="mdi-code-json"
    label="Asset"
    label-plural="Assets"
    :query="queryAssets"
    :update="updateAsset"
  >
    <template #item-title="{ item }">
      {{ item?.properties?.displayName || item?.properties?.name || item?.properties?.description }}
    </template>

    <template #item-subtitle="{ item }">
      {{ item['@id'] }}
    </template>

    <template #dialogs="{ proxyId, onCreated }">
      <CreateAssetDialog
        v-model="createAssetDialog"
        :proxy-id="proxyId"
        @assets-created="assetId => onCreated(assetId, false)"
      />

      <CreateAssetFromTemplateDialog
        v-model="createAssetFromTemplateDialog"
        :proxy-id="proxyId"
        @assets-created="assetId => onCreated(assetId, false)"
      />

      <CreateAssetFromInfrastructureDialog
        v-model="createAssetFromInfrastructureDialog"
        :proxy-id="proxyId"
        @assets-created="onCreated"
      />
    </template>

    <!-- Deletes the contracts referencing the asset as well -->
    <template #delete-dialog="{ dialog, proxyId, onDeleted }">
      <DeleteAssetDialog
        v-model="dialog.open"
        :asset="dialog.resource"
        :proxy-id="proxyId"
        @deleted="onDeleted"
      />
    </template>
  </EdcResourceTab>
</template>

<script lang="ts" setup>
  import { useCatenaXEdcClient } from '@/composables/Client/CatenaXEdcClient'
  import CreateAssetDialog from '@/pages/modules/EclipseDataspaceConnector/components/Assets/Dialogs/CreateAssetDialog.vue'
  import CreateAssetFromInfrastructureDialog from '@/pages/modules/EclipseDataspaceConnector/components/Assets/Dialogs/CreateAssetFromInfrastructureDialog.vue'
  import CreateAssetFromTemplateDialog from '@/pages/modules/EclipseDataspaceConnector/components/Assets/Dialogs/CreateAssetFromTemplateDialog.vue'
  import DeleteAssetDialog from '@/pages/modules/EclipseDataspaceConnector/components/Assets/Dialogs/DeleteAssetDialog.vue'
  import EdcResourceTab from '@/pages/modules/EclipseDataspaceConnector/components/Shared/EdcResourceTab.vue'

  // Composables
  const { queryAssets, updateAsset } = useCatenaXEdcClient()

  // Data
  const createAssetDialog = ref(false)
  const createAssetFromTemplateDialog = ref(false)
  const createAssetFromInfrastructureDialog = ref(false)

  const createActions = [
    { title: 'Create Asset', tooltip: 'Create a new asset', onClick: () => (createAssetDialog.value = true) },
    { title: 'Create Asset from Template', tooltip: 'Create a new asset from Template', onClick: () => (createAssetFromTemplateDialog.value = true) },
    { title: 'Create Asset from AAS Infrastructure', tooltip: 'Create a new asset from an AAS of a preconfigured infrastructure', onClick: () => (createAssetFromInfrastructureDialog.value = true) },
  ]
</script>
