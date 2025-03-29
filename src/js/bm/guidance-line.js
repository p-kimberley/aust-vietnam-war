/**
 * A visual cue to the user associating a DOM element with a point on the map.
 * An example is where the user selects a marker and a line is drawn between the marker and the context panel.
 * @param {ol.Coordinate} mapTarget
 * @param {jQuery} domTarget
 * @param {[]} [domTargetOffset] - Offset in X,Y pixels from the line DOM target
 * @param {string} fillColour
 * @param {string} strokeColour
 * @constructor
 */
BM.GuidanceLine = function(mapTarget, domTarget, domTargetOffset, fillColour, strokeColour)
{
	/** @type {ol.Coordinate} */
	this.mapTarget = mapTarget || [0, 0];
	/** @type {jQuery} */
	this.domTarget = domTarget;
	this.domTargetOffset = domTargetOffset || [0, 0];

	this.initialised = false;
	this.showing = false;

	this.canvas = document.createElement('canvas');
	$(this.canvas)
		.addClass('effects-canvas')
		.appendTo('#left-container');

	this.fillStyle = new ol.style.Style({
		stroke: new ol.style.Stroke({
			color: fillColour,
			width: 2
		})
	});

	this.strokeStyle = new ol.style.Style({
		stroke: new ol.style.Stroke({
			color: strokeColour,
			width: 3
		})
	});
};

/**
 * Initialises geometry, once valid coordinates have been passed
 * @private
 */
BM.GuidanceLine.prototype.initGeometry = function()
{
	var self = this;
	this.initialised = true;

	BM.map.addEventListener('postcompose', function(event) {
		self.render();
	});
};

/**
 * Draws the guidance line using OL3 canvas immediate mode
 * @private
 */
BM.GuidanceLine.prototype.render = function()
{
	if (this.showing)
	{
		var vectorContext = ol.render.toContext(this.canvas.getContext('2d'), {
			size: BM.map.getSize()
		});

		var mapTarget = BM.map.getPixelFromCoordinate([this.mapTarget[0], this.mapTarget[1]]);
		var domTarget = this.getDOMCoords();

		if (mapTarget && domTarget)
		{
			vectorContext.setStyle(this.strokeStyle);
			vectorContext.drawGeometry(new ol.geom.LineString([mapTarget, domTarget]));
			vectorContext.setStyle(this.fillStyle);
			vectorContext.drawGeometry(new ol.geom.LineString([mapTarget, domTarget]));
		}
		else
		{
			if (!mapTarget)
				console.warn('Guidance line does not have valid map target coordinates');
			if (!domTarget)
				console.warn('Guidance line does not have valid DOM target coordinates');
		}
	}
};

/**
 * Converts DOM pixel position to projected map coordinates
 * @returns {ol.Coordinate|*}
 * @private
 */
BM.GuidanceLine.prototype.getDOMCoords = function()
{
	if (BM.map && this.domTarget)
	{
		var offset = this.domTarget.offset();
		var coords = [offset.left, offset.top];

		if (this.domTargetOffset)
		{
			coords[0] += this.domTargetOffset[0];
			coords[1] += this.domTargetOffset[1];
		}

		return coords;
	}
	else
	{
		return [0, 0];
	}
};

/**
 * Invoke this when the map view changes. Recomputes the linestring coordinate to make the line remain
 * 'pinned' to the DOM element's position in relation to the map.
 */
BM.GuidanceLine.prototype.updateGeometry = function()
{
	if (!this.initialised)
		this.initGeometry();
};

/**
 * Assigns a location as a line coordinate
 * @param {ol.Coordinate} coords - Projected coordinates
 */
BM.GuidanceLine.prototype.setMapTargetCoords = function(coords)
{
	if (coords)
		this.mapTarget = coords;
};

/**
 * @param {jQuery} target
 */
BM.GuidanceLine.prototype.setDOMTarget = function(target)
{
	this.domTarget = target;
	this.render();
};

BM.GuidanceLine.prototype.hide = function()
{
	this.showing = false;
	$(this.canvas).hide();
};

BM.GuidanceLine.prototype.show = function()
{
	this.showing = true;
	this.render();
	$(this.canvas).show();
};