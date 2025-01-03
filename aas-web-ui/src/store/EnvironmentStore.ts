import { defineStore } from 'pinia';
import { computed, ref } from 'vue';

const isProduction = import.meta.env.MODE === 'production';
console.log('EnvironmentStore.ts -> isProduction: ', isProduction);

export const useEnvStore = defineStore('envStore', () => {
    // state
    const basePath = ref(import.meta.env.VITE_BASE_PATH || (isProduction ? '/__BASE_PATH_PLACEHOLDER__/' : ''));
    const logoLightPath = ref(
        import.meta.env.VITE_LOGO_LIGHT_PATH || (isProduction ? '/__LOGO_LIGHT_PATH_PLACEHOLDER__/' : '')
    );
    const logoDarkPath = ref(
        import.meta.env.VITE_LOGO_DARK_PATH || (isProduction ? '/__LOGO_DARK_PATH_PLACEHOLDER__/' : '')
    );
    const aasDiscoveryPath = ref(
        import.meta.env.VITE_AAS_DISCOVERY_PATH || (isProduction ? '/__AAS_DISCOVERY_PATH_PLACEHOLDER__/' : '')
    );
    const aasRegistryPath = ref(
        import.meta.env.VITE_AAS_REGISTRY_PATH || (isProduction ? '/__AAS_REGISTRY_PATH_PLACEHOLDER__/' : '')
    );
    const submodelRegistryPath = ref(
        import.meta.env.VITE_SUBMODEL_REGISTRY_PATH || (isProduction ? '/__SUBMODEL_REGISTRY_PATH_PLACEHOLDER__/' : '')
    );
    const aasRepoPath = ref(
        import.meta.env.VITE_AAS_REPO_PATH || (isProduction ? '/__AAS_REPO_PATH_PLACEHOLDER__/' : '')
    );
    const submodelRepoPath = ref(
        import.meta.env.VITE_SUBMODEL_REPO_PATH || (isProduction ? '/__SUBMODEL_REPO_PATH_PLACEHOLDER__/' : '')
    );
    const conceptDescriptionRepoPath = ref(
        import.meta.env.VITE_CD_REPO_PATH || (isProduction ? '/__CD_REPO_PATH_PLACEHOLDER__/' : '')
    );
    const dashboardServicePath = ref(
        import.meta.env.VITE_DASHBOARD_SERVICE_PATH || (isProduction ? '/__DASHBOARD_SERVICE_PATH_PLACEHOLDER__/' : '')
    );
    const primaryLightColor = ref(
        import.meta.env.VITE_PRIMARY_LIGHT_COLOR || (isProduction ? '/__PRIMARY_LIGHT_COLOR_PLACEHOLDER__/' : '')
    );
    const primaryDarkColor = ref(
        import.meta.env.VITE_PRIMARY_DARK_COLOR || (isProduction ? '/__PRIMARY_DARK_COLOR_PLACEHOLDER__/' : '')
    );
    const influxdbToken = ref(
        import.meta.env.VITE_INFLUXDB_TOKEN || (isProduction ? '/__INFLUXDB_TOKEN_PLACEHOLDER__/' : '')
    );
    const keycloakActive = ref(
        import.meta.env.VITE_KEYCLOAK_ACTIVE || (isProduction ? '/__KEYCLOAK_ACTIVE_PLACEHOLDER__/' : '')
    );
    const keycloakUrl = ref(
        import.meta.env.VITE_KEYCLOAK_URL || (isProduction ? '/__KEYCLOAK_URL_PLACEHOLDER__/' : '')
    );
    const keycloakRealm = ref(
        import.meta.env.VITE_KEYCLOAK_REALM || (isProduction ? '/__KEYCLOAK_REALM_PLACEHOLDER__/' : '')
    );
    const keycloakClientId = ref(
        import.meta.env.VITE_KEYCLOAK_CLIENT_ID || (isProduction ? '/__KEYCLOAK_CLIENT_ID_PLACEHOLDER__/' : '')
    );
    const endpointConfigAvailable = ref(
        import.meta.env.VITE_ENDPOINT_CONFIG_AVAILABLE ||
            (isProduction ? '/__ENDPOINT_CONFIG_AVAILABLE_PLACEHOLDER__/' : '')
    );
    const singleAas = ref(import.meta.env.VITE_SINGLE_AAS || (isProduction ? '/__SINGLE_AAS_PLACEHOLDER__/' : ''));
    const singleAasRedirect = ref(
        import.meta.env.VITE_SINGLE_AAS_REDIRECT || (isProduction ? '/__SINGLE_AAS_REDIRECT_PLACEHOLDER__/' : '')
    );

    // getters
    const getEnvBasePath = computed(() => basePath.value);
    const getEnvLogoLightPath = computed(() => logoLightPath.value);
    const getEnvLogoDarkPath = computed(() => logoDarkPath.value);
    const getEnvAASDiscoveryPath = computed(() => aasDiscoveryPath.value);
    const getEnvAASRegistryPath = computed(() => aasRegistryPath.value);
    const getEnvSubmodelRegistryPath = computed(() => submodelRegistryPath.value);
    const getEnvAASRepoPath = computed(() => aasRepoPath.value);
    const getEnvSubmodelRepoPath = computed(() => submodelRepoPath.value);
    const getEnvConceptDescriptionRepoPath = computed(() => conceptDescriptionRepoPath.value);
    const getEnvDashboardServicePath = computed(() => dashboardServicePath.value);
    const getEnvPrimaryLightColor = computed(() => primaryLightColor.value);
    const getEnvPrimaryDarkColor = computed(() => primaryDarkColor.value);
    const getEnvInfluxdbToken = computed(() => influxdbToken.value);
    const getKeycloakActive = computed(() => keycloakActive.value === 'true');
    const getKeycloakUrl = computed(() => keycloakUrl.value);
    const getKeycloakRealm = computed(() => keycloakRealm.value);
    const getKeycloakClientId = computed(() => keycloakClientId.value);
    const getEndpointConfigAvailable = computed(() => endpointConfigAvailable.value === 'true');
    const getSingleAas = computed(() => singleAas.value === 'true');
    const getSingleAasRedirect = computed(() => {
        if (singleAas.value === 'true' && singleAasRedirect.value) {
            const expression =
                /^(?:(?:(?:https?|ftp):)?\/\/)(?:\S+(?::\S*)?@)?(?:(?!(?:10|127)(?:\.\d{1,3}){3})(?!(?:169\.254|192\.168)(?:\.\d{1,3}){2})(?!172\.(?:1[6-9]|2\d|3[0-1])(?:\.\d{1,3}){2})(?:[1-9]\d?|1\d\d|2[01]\d|22[0-3])(?:\.(?:1?\d{1,2}|2[0-4]\d|25[0-5])){2}(?:\.(?:[1-9]\d?|1\d\d|2[0-4]\d|25[0-4]))|(?:(?:[a-z0-9\u00a1-\uffff][a-z0-9\u00a1-\uffff_-]{0,62})?[a-z0-9\u00a1-\uffff]\.)+(?:[a-z\u00a1-\uffff]{2,}\.?))(?::\d{2,5})?(?:[/?#]\S*)?$/i;
            const regex = new RegExp(expression);
            if (singleAasRedirect.value.match(regex)) {
                return singleAasRedirect.value;
            }
            return undefined;
        }
        return undefined;
    });

    return {
        singleAas,
        getEnvBasePath,
        getEnvLogoLightPath,
        getEnvLogoDarkPath,
        getEnvAASDiscoveryPath,
        getEnvAASRegistryPath,
        getEnvSubmodelRegistryPath,
        getEnvAASRepoPath,
        getEnvSubmodelRepoPath,
        getEnvConceptDescriptionRepoPath,
        getEnvDashboardServicePath,
        getEnvPrimaryLightColor,
        getEnvPrimaryDarkColor,
        getEnvInfluxdbToken,
        getKeycloakActive,
        getKeycloakUrl,
        getKeycloakRealm,
        getKeycloakClientId,
        getEndpointConfigAvailable,
        getSingleAas,
        getSingleAasRedirect,
    };
});
