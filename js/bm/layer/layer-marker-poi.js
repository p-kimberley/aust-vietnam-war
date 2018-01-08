/**
 * Displays an icon for each media upload
 * @param {string} title
 * @param {number} [zIndex]
 * @constructor
 * @extends {BM.Layer.Marker}
 */
BM.Layer.Marker.PointOfInterest = function(title, zIndex)
{
	BM.Layer.Marker.call(this, BM.LayerType.poi.fsb, title, zIndex);

	var self = this;
	this.markerTooltip = new BM.MarkerTooltip.PointOfInterest(this);
	this.silentRegeneration = true;

	// Minimum zoom level at which to display POI labels
	this.minLabelZoomDisplayLevel = 14;

	//var iconArtillery = this.generateCanvasImage($('#artillery-icon'));
	var iconArtillery = BM.options.markerIconBaseUrl + 'poi-artillery.png';
	this.icons = {
		'FSB': iconArtillery,
		'FSPB': iconArtillery
	};
};

BM.Layer.Marker.PointOfInterest.prototype = Object.create(BM.Layer.Marker.prototype);
BM.Layer.Marker.PointOfInterest.prototype.constructor = BM.Layer.Marker.PointOfInterest;

/**
 * @param [callback]
 */
BM.Layer.Marker.PointOfInterest.prototype.generate = function (callback)
{
	BM.Layer.Marker.prototype.generate.call(this);

	var self = this;
	var markerStyle = function() {
		var props = this.getProperties();
		var icon = self.icons[props.type];
		var label = props.type + ' ' + props.name;
		var zoomLevel = BM.map.getView().getZoom();

		if (icon)
		{
			var textStyle = undefined;
			if (zoomLevel >= self.minLabelZoomDisplayLevel)
			{
				textStyle = new ol.style.Text({
					font: 'bold 13px sans-serif',
					text: label,
					offsetY: 10,
					stroke: new ol.style.Stroke({
						color: 'rgba(255, 255, 255, 0.9)',
						width: 3
					})
				});
			}

			return [new ol.style.Style({
				image: new ol.style.Icon({
					src: BM.options.markerIconBaseUrl + 'poi-artillery.png',
					/*img: icon.canvas,
					imgSize: [icon.width, icon.height],*/
					anchor: [.5, 1]
				}),
				text: textStyle
			})];
		}
	};

	if (this.canvas)
		document.removeChild(this.canvas);

	$.ajax({
		url: '/api/es/search/avw_poi',
		method: 'POST',
		dataType: 'json',
		contentType: 'application/json',
		data: JSON.stringify({
			"size": 999,
			"_source": ["ID", "Type", "Name", "Established", "Location"]
		})
	}).done(function(data)
	{
		$.each(data.hits.hits, function (i, item) {
			var fields = item._source;
			var location = fields.Location;
			var coords = ol.proj.transform([location.lon, location.lat], 'EPSG:3857');

			var marker = new ol.Feature({
				geometry: new ol.geom.Point(coords),
				labelPoint: new ol.geom.Point(coords),
				name: fields.Type + ' ' + fields.Name
			});

			marker.setProperties({
				type: fields.Type,
				name: fields.Name,
				established: fields.Established,
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
				}),
				updateWhileAnimating: true,
				updateWhileInteracting: true
			});

			self.olLayer.set('id', self.type);
			BM.map.addLayer(self.olLayer);
		}

		if (callback)
			callback();
	});
};

/**
 * Creates a Canvas image in the DOM
 * @param {jQuery} img
 * @returns {{canvas,width,height}}
 * @protected
 */
BM.Layer.Marker.PointOfInterest.prototype.generateCanvasImage = function(img)
{
	var canvas = document.createElement('canvas');
	var context = canvas.getContext('2d');
	var width = img.width();
	var height = img.height();

	canvas.width = width;
	canvas.height = height;

	context.drawImage(img[0], 0, 0, canvas.width, canvas.height);

	return {
		canvas: canvas,
		width: width,
		height: height
	};
};