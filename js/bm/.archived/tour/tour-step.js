/**
 * Base class defining a tour step
 * @param {json} options
 * @param {string} options.title - Title of the tooltip
 * @param {string} options.buttonText - Inner text to use for the 'next' button
 * @param {string} [options.buttonAlign=left] - CSS alignment for the button position (i.e. 'right')
 * @param {string} [options.position] - Tooltipster position
 * @param {number} [options.offsetX] - Tooltip X offset from origin, in pixels
 * @param {number} [options.offsetY] - Tooltip Y offset in pixels
 * @param {string} options.body - Body markup
 * @param {function} options.tooltipTargetFn - Must accept and invoke callback fn with the tooltip target jQuery object as the parameter
 * @param {function} [options.stepCompletionFn] - Method to call once the tour step is done. Must accept a callback parameter and call this on completion
 * @constructor
 */
BM.TourStep = function(options)
{
	this.title = options.title;
	this.buttonText = options.buttonText;
	this.buttonAlign = options.buttonAlign || 'left';
	this.position = options.position;
	this.offsetX = options.offsetX || 0;
	this.offsetY = options.offsetY || 0;
	this.body = options.body;
	this.tooltipTargetFn = options.tooltipTargetFn;
	this.stepCompletionFn = options.stepCompletionFn;
	this.tooltipTarget = null;					// Set by showStep() as a result of invoking the tooltipTargetFn() function reference
	this.tooltipsterInstance = null;			// Set to the Tooltipster instance once bound to the target
};

/**
 * Overridable method to generate the tooltip internal markup
 * @returns {string}
 */
BM.TourStep.prototype.generateTooltipMarkup = function()
{
	return '<div class="tour-step-container">' +
		'<div class="tour-step-button-close" title="Stop the tour"></div>' +
		'<div class="tour-step-title">' + this.title + '</div>' +
		'<div class="tour-step-body">' + this.body + '</div>' +
		'<div class="tour-step-button-container" style="text-align: ' + this.buttonAlign + '"><button>' + this.buttonText + '</div>' +
		'</div>';
};

/**
 * @param [callback]
 */
BM.TourStep.prototype.showStep = function(callback)
{
	var self = this;
	if (this.tooltipTargetFn)
	{
		this.tooltipTargetFn(function (tooltipTarget) {
			self.tooltipTarget = tooltipTarget;
			if (self.tooltipTarget)
			{
				var tooltipContent = $(self.generateTooltipMarkup());
				tooltipContent.find('div.tour-step-button-container').find('button').click(function() {
					BM.Tour.nextTourStep();
				});

				tooltipContent.find('div.tour-step-button-close')
					.tooltipster({
						position: 'top'
					})
					.click(function() {
						BM.Tour.endTour();
					});

				self.tooltipsterInstance = self.tooltipTarget.tooltipster({
					minWidth: 300,
					maxWidth: 500,
					content: tooltipContent,
					position: self.position,
					offsetX: self.offsetX,
					offsetY: self.offsetY,
					autoClose: false,
					animation: 'grow',
					updateAnimation: false,
					multiple: true,
					interactive: true,
					positionTracker: true,
					restoration: 'none'
				})[0];

				if (self.tooltipsterInstance)
				{
					self.tooltipsterInstance.show();
					self.tooltipsterInstance.$tooltip.draggable();
				}
				else
				{
					console.log('Error: Tooltipster not initialised on target');
				}
			}

			if (callback)
				return callback();
		});
	}
	else
	{
		// Incorrect parameters were specified, so skip to the next step
		console.log('Warning: Tour step skipped due to an unset tooltip target. Step title: "' + this.title + '"');
		BM.Tour.nextTourStep();
	}
};

BM.TourStep.prototype.endStep = function(callback)
{
	if (this.tooltipsterInstance)
	{
		this.tooltipsterInstance.destroy();
		this.tooltipsterInstance = null;

		if (this.stepCompletionFn)
			return this.stepCompletionFn(callback);
	}

	if (callback)
		callback();
};

/**
 * Tour step template where a tooltip is displayed against a certain element and progresses to the next step once the user
 * clicks or otherwise interacts with another
 * @param {json} options
 * @param {string} options.title
 * @param {string} options.position
 * @param {number} [options.offsetX]
 * @param {number} [options.offsetY]
 * @param {string} options.body
 * @param {function} options.tooltipTargetFn
 * @param {function} [options.stepCompletionFn]
 * @param {function} options.waitForTargetFn - Target element to wait for the user to interact with, before the tour step is progressed
 * @param {string} [options.waitForInteraction=click] - Type of interaction to wait for. Default is 'click'
 * @constructor
 * @extends {BM.TourStep}
 */
BM.TourStep_WaitForInteraction = function(options)
{
	BM.TourStep.call(this, options);

	this.waitForTargetFn = options.waitForTargetFn;
	this.waitForTarget = null;
	this.waitForInteraction = options.waitForInteraction || 'click';
};

BM.TourStep_WaitForInteraction.prototype = Object.create(BM.TourStep.prototype);
BM.TourStep_WaitForInteraction.prototype.constructor = BM.TourStep_WaitForInteraction;

BM.TourStep_WaitForInteraction.prototype.generateTooltipMarkup = function()
{
	return '<div class="tour-step-container">' +
		'<div class="tour-step-button-close" title="Stop the tour"></div>' +
		'<div class="tour-step-title">' + this.title + '</div>' +
		'<div class="tour-step-body">' + this.body + '</div>' +
		'</div>';
};

/**
 * Binds to a target element and waits for the user to interact with it (i.e. clicks a button). It then
 * destroys the tooltip and progresses to the next tour step
 * @param [callback]
 */
BM.TourStep_WaitForInteraction.prototype.showStep = function(callback)
{
	var self = this;
	BM.TourStep.prototype.showStep.call(this, function() {
		if (self.waitForTargetFn)
		{
			self.waitForTargetFn(function(waitForTarget) {
				// If there is a valid wait target, bind to that element. Otherwise skip to the next tour step
				self.waitForTarget = waitForTarget;
				if (self.waitForTarget)
				{
					self.waitForTarget.one(self.waitForInteraction, function() {
						BM.Tour.nextTourStep();
					});
				}
			});
		}
		else
		{
			self.endStep();
		}
	});
};