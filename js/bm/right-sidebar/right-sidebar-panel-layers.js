/**
 * Enables the user to customise the map using different combinations of layers and overlays.
 * Coordinates the initialisation of layers.
 * @extends {BM.RightSidebarPanel}
 * @constructor
 */
BM.RightSidebarPanel.Layers = function() {
	BM.RightSidebarPanel.call(this, 'layers', '#right-sidebar-button-layers', '#right-sidebar-panel-layers', true);

	/** @type {BM.BasemapController} */
	this.basemapController = new BM.BasemapController($('#map-basemap-selector'));
	/** @type {BM.LayerController} */
	this.layerController = new BM.LayerController($('#map-layer-selector'));
};

BM.RightSidebarPanel.Layers.prototype = Object.create(BM.RightSidebarPanel.prototype);
BM.RightSidebarPanel.Layers.prototype.constructor = BM.RightSidebarPanel.Layers;

BM.RightSidebarPanel.Layers.prototype.init = function()
{
	$('#world-view-selector-form').buttonset();

	// Disable 2d/3d toggle control if the 3d feature is disabled
	if (!BM.map3dFeatureEnabled)
	{
		$(this.panelElement).find('.world-view').hide();
	}
	else
	{
		$('#world-view-2d').click(function () {
			BM.map3dMode(false);
		});
		$('#world-view-3d').click(function () {
			BM.map3dMode(true);
		});
	}

	BM.LoadingProgress.update(false, 'Loading basemaps');
	this.basemapController
		.addBasemap(new BM.Layer.Basemap(BM.BasemapType.mapbox.terrain, 'Terrain', 'Caption', BM.Layers.createTerrainBasemap))
		.addBasemap(new BM.Layer.Basemap(BM.BasemapType.mapbox.satellite, 'Satellite', 'Caption', BM.Layers.createSatBasemap))
		.addBasemap(new BM.Layer.Basemap(BM.BasemapType.mapbox.light, 'Light', 'Caption', BM.Layers.createLightBasemap))
		.addBasemap(new BM.Layer.Basemap(BM.BasemapType.mapbox.dark, 'Dark', 'Caption', BM.Layers.createDarkBasemap));

	BM.LoadingProgress.update(false, 'Loading map layers');
	this.layerController.addGroup(new BM.LayerGroup(BM.LayerGroupType.militaryMap, '1ATF topo maps', 'Caption', 10, false))
		.addLayer(new BM.Layer.Tile(BM.LayerType.military.shaded1atf, 'Hillshaded', { url: '/geoserver/vietnam/wms', layers: 'vietnam:1atf-topo-hillshaded' }))
		.addLayer(new BM.Layer.Tile(BM.LayerType.military.classic1atf, 'Classic', { url: '/geoserver/vietnam/wms', layers: 'vietnam:1atf-topo-classic' }));

	this.layerController.addGroup(new BM.LayerGroup(BM.LayerGroupType.detail, 'Detail maps', 'Caption', 11, true))
		.addLayer(new BM.Layer.Tile(BM.LayerType.detail.all, 'Bases and towns', { url: '/geoserver/vietnam/wms', layers: 'vietnam:military-bases' }));

	this.layerController.addGroup(new BM.LayerGroup(BM.LayerGroupType.contact, 'Combat operations', 'Caption', 50, false))
		.addLayer(new BM.Layer.Marker.Incident.Circles('AUS/NZ land operations'))
		.addLayer(new BM.Layer.AirOperations(BM.LayerType.contact.airSorties, 'Air sorties', { url: '/geoserver/vietnam/wms' }))
		.addLayer(new BM.Layer.SeaOperations(BM.LayerType.contact.navalFireMissions, 'Naval gunfire missions', { url: '/geoserver/vietnam/wms' }));

	this.layerController.addGroup(new BM.LayerGroup(BM.LayerGroupType.poi, 'Points of interest', 'Caption', 51, true))
		.addLayer(new BM.Layer.Marker.PointOfInterest('Fire support bases'));

	var concentrationsGroup = this.layerController.addGroup(new BM.LayerGroup(BM.LayerGroupType.concentration, 'Concentrations', 'Caption', 20, false))
		.addLayer(new BM.Layer.Heatmap.Contact(BM.LayerType.concentration.incidents, 'Incidents'));

	this.layerController.addGroup(new BM.LayerGroup(BM.LayerGroupType.media, 'Community content', 'Caption', 60, true))
		.addLayer(new BM.Layer.Marker.MediaByLocation('Photos and videos'));
};