BM.Layers = (function ()
{
	var _hidpi = BM.constants.devicePixelRatio > 1 ? '@2x' : '';

	/**
	 * Handles the creation of a topo map object for the BM.LayerController
	 * @param {BM.Layer.Basemap} basemapLayer
	 * @private
	 */
	function _createTerrainBasemap(basemapLayer)
	{
		if (basemapLayer)
		{
			basemapLayer.olLayer = new ol.layer.Tile({
				source: new ol.source.TileImage({
					url: 'https://api.mapbox.com/styles/v1/gradata-systems/ciz3d962m001y2rq7tymjoy5o/tiles/256/{z}/{x}/{y}' + _hidpi + '?access_token=pk.eyJ1IjoiZ3JhZGF0YS1zeXN0ZW1zIiwiYSI6ImNpZ29ldWo1djAwMnp1c20xOWVuZWsxaXQifQ.8ylL9OLBolBs6r2o25da5w',
					//url: 'http://tiles.intranet.gradata.com.au/styles/terrain/{z}/{x}/{y}@2x.png',
					crossOrigin: 'Anonymous',
					tilePixelRatio: BM.constants.devicePixelRatio,
					projection: 'EPSG:3857'
				})
			});
		}
	}

	/**
	 * @param {BM.Layer.Basemap} basemapLayer
	 * @private
	 */
	function _createSatBasemap(basemapLayer)
	{
		if (basemapLayer)
		{
			basemapLayer.olLayer = new ol.layer.Group({
				layers: [
					new ol.layer.Tile({
						source: new ol.source.TileArcGISRest({
							url: 'https://server.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer',
							crossOrigin: 'anonymous',
							params: {
								'FORMAT': 'jpg'
							}
						})
					}),
					new ol.layer.Tile({
						source: new ol.source.TileArcGISRest({
							url: 'https://server.arcgisonline.com/arcgis/rest/services/Reference/World_Boundaries_and_Places/MapServer',
							crossOrigin: 'anonymous'
						}),
						minResolution: 22
					})
				]
			});
		}
	}

	/**
	 * @param {BM.Layer.Basemap} basemapLayer
	 * @private
	 */
	function _createLightBasemap(basemapLayer)
	{
		if (basemapLayer)
		{
			basemapLayer.olLayer = new ol.layer.Tile({
				source: new ol.source.XYZ({
					url: 'https://api.mapbox.com/styles/v1/mapbox/light-v9/tiles/256/{z}/{x}/{y}' + _hidpi + '?access_token=pk.eyJ1Ijoia2ltYmVybGV5cCIsImEiOiJDMEhFZ0RjIn0.5nKgLWgVptAO-QCS7Y035w',
					crossOrigin: 'Anonymous',
					tilePixelRatio: BM.constants.devicePixelRatio
				})
			});
		}
	}

	/**
	 * @param {BM.Layer.Basemap} basemapLayer
	 * @private
	 */
	function _createDarkBasemap(basemapLayer)
	{
		if (basemapLayer)
		{
			basemapLayer.olLayer = new ol.layer.Tile({
				source: new ol.source.XYZ({
					url: 'https://api.mapbox.com/styles/v1/mapbox/dark-v9/tiles/256/{z}/{x}/{y}' + _hidpi + '?access_token=pk.eyJ1Ijoia2ltYmVybGV5cCIsImEiOiJDMEhFZ0RjIn0.5nKgLWgVptAO-QCS7Y035w',
					crossOrigin: 'Anonymous',
					tilePixelRatio: BM.constants.devicePixelRatio
				})
			});
		}
	}

	return {
		createTerrainBasemap: _createTerrainBasemap,
		createSatBasemap: _createSatBasemap,
		createLightBasemap: _createLightBasemap,
		createDarkBasemap: _createDarkBasemap
	}
})();