<template>
  <EdcResourceTab
    :create-actions="createActions"
    :delete="deleteContractDefinition"
    icon="mdi-file-sign"
    label="Contract"
    label-plural="Contracts"
    :query="queryContractDefinitions"
    :update="updateContractDefinition"
  >
    <template #dialogs="{ proxyId, onCreated }">
      <CreateContractDialog v-model="createContractDialog" :proxy-id="proxyId" @contract-created="onCreated" />
    </template>
  </EdcResourceTab>
</template>

<script lang="ts" setup>
  import { useCatenaXEdcClient } from '@/composables/Client/CatenaXEdcClient'
  import CreateContractDialog from '@/pages/modules/EclipseDataspaceConnector/components/Contracts/Dialogs/CreateContractDialog.vue'
  import EdcResourceTab from '@/pages/modules/EclipseDataspaceConnector/components/Shared/EdcResourceTab.vue'

  // Composables
  const { deleteContractDefinition, queryContractDefinitions, updateContractDefinition } = useCatenaXEdcClient()

  // Data
  const createContractDialog = ref(false)

  const createActions = [
    { title: 'Create Contract', tooltip: 'Create a new Contract', onClick: () => (createContractDialog.value = true) },
  ]
</script>
