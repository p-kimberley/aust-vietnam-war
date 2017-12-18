/**
 * Displays an icon for each media upload
 * @param {string} title
 * @param {number} [zIndex]
 * @constructor
 * @extends {BM.Layer.Marker}
 */
BM.Layer.Marker.MediaByLocation = function(title, zIndex)
{
	BM.Layer.Marker.call(this, BM.LayerType.media.iconsByLocation, title, zIndex);

	var self = this;
	this.silentRegeneration = true;

	$('body')
		.on('bm:mediamarker.selected', function(event) {
			var marker = event.feature;
			var lat = marker.get('lat');
			var lon = marker.get('lon');

			// Get the top n media items near the location of the selected marker and open the media gallery
			BM.Media.requeryMediaReelByLonLat([lon, lat], function() {
				BM.Media.openLightbox();
			});

			BM.ActivityLogging.logEvent(BM.LogEventTypes.openedMediaItemFromMap, null, lat + "," + lon);
		})
		.on('bm:media.uploadcompleted', function(event) {
			// If the user has upload media items, regenerate this layer
			self.regenerate();
		});
};

BM.Layer.Marker.MediaByLocation.prototype = Object.create(BM.Layer.Marker.prototype);
BM.Layer.Marker.MediaByLocation.prototype.constructor = BM.Layer.Marker.MediaByLocation;

/**
 * @param [callback]
 */
BM.Layer.Marker.MediaByLocation.prototype.generate = function (callback)
{
	BM.Layer.Marker.prototype.generate.call(this);

	var self = this;
	var markerStyle = function() {
		return [new ol.style.Style({
			image: new ol.style.Icon({
				//src: this.get('imageUrl'),
				//scale: 0.05,
				src: '/images/Marker-Media.png'
			})
		})];
	};

	if (this.canvas)
		document.removeChild(this.canvas);

	$.ajax({
		url: '/api/es/search/avw_incident_media',
		method: 'POST',
		dataType: 'json',
		contentType: 'application/json',
		data: JSON.stringify({
			"size": 1000,
			"query": {
				"match": {
					"Approval_Status": 1
				}
			}
		})
	}).done(function(response) {
		$.each(response.hits.hits, function(i, item) {
			var fields = item._source;
			var marker = new ol.Feature({
				geometry: new ol.geom.Point([fields.Location.lon, fields.Location.lat])
			});

			marker.setProperties({
				lat: fields.Location.lat,
				lon: fields.Location.lon,
				imageUrl: BM.options.incidentMediaBaseUrl + fields.Path,
				layer: self
			});

			marker.setStyle(markerStyle);
			self.markers.push(marker);
		});

		if (!self.olLayer)
		{
			self.olLayer = new ol.layer.Vector({
				source: new ol.source.Vector({
					features: self.markers
				})
			});

			self.olLayer.set('id', self.type);
			BM.map.addLayer(self.olLayer);
		}

		if (callback)
			callback();
	});
};

/**
 * Marks an individual marker as selected
 * @param {ol.Feature} marker
 */
BM.Layer.Marker.MediaByLocation.prototype.selectMarker = function(marker)
{
	this.firstSelectInteraction = false;

	$('body').trigger($.Event('bm:mediamarker.selected', {
		feature: marker,
		layer: this
	}));
};

/**
 * Deselects an individual marker
 * @param {ol.Feature} marker
 */
BM.Layer.Marker.MediaByLocation.prototype.deselectMarker = function(marker)
{
	this.firstSelectInteraction = false;

	$('body').trigger($.Event('bm:mediamarker.deselected', {
		feature: marker,
		layer: this
	}));
};