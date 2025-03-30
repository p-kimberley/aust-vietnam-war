FROM bitnami/wordpress:6.7.2

WORKDIR /opt/bitnami/wordpress
COPY --chmod=444 src src
COPY --chmod=444 images images

# Ensure directories are traversable
USER 0
RUN find ./src -type d -exec chmod 555 {} \;
RUN find ./images -type d -exec chmod 555 {} \;

USER 1001

ENTRYPOINT [ "/opt/bitnami/scripts/wordpress/entrypoint.sh" ]
CMD [ "/opt/bitnami/scripts/apache/run.sh" ]